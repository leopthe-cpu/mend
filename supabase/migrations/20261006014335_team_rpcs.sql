-- Phase 1B: invites, roles, member removal, ownership transfer (spec §5).
-- Every rule is enforced here, in the database, not only in the UI:
--   * nobody grants a role higher than their own; Admins handle Staff only
--   * the Owner can't be removed or demoted; ownership moves only through an
--     Owner-started transfer with a fresh password check (and MFA if enrolled)
--   * invite tokens are random, single-use, expire after 72 h, are bound to an
--     email and a role, and only their SHA-256 hash is stored (spec §4)

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and char_length(email) <= 254),
  role public.member_role not null check (role <> 'owner'),
  token_hash text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invites_shop_idx on public.invites (shop_id, created_at desc);
create trigger invites_set_updated_at before update on public.invites
  for each row execute function private.set_updated_at();

alter table public.invites enable row level security;
-- Owner/Admin see their shop's invites, but never the token hash.
grant select (id, shop_id, email, role, invited_by, expires_at, used_at, used_by, revoked_at, created_at, updated_at)
  on public.invites to authenticated;
create policy invites_select_admins on public.invites
  for select to authenticated
  using ((select private.has_role(shop_id, 'admin')));

create function private.hash_token(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

-- The caller's verified auth email (lowercase). Definer: reads auth.users.
create function private.my_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email) from auth.users u where u.id = (select auth.uid());
$$;

-- True when the caller signed in with their password within p_window, and has
-- passed MFA in this session if they have a verified factor (spec §4:
-- "ownership transfer and bulk export require re-entering the password (and
-- MFA when enabled)"). Reads the `amr` and `aal` JWT claims.
create function private.recently_reauthenticated(p_window interval default interval '10 minutes')
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_jwt jsonb := auth.jwt();
  v_pw_at timestamptz;
  v_has_mfa boolean;
begin
  select max(to_timestamp((e ->> 'timestamp')::double precision))
    into v_pw_at
    from jsonb_array_elements(coalesce(v_jwt -> 'amr', '[]'::jsonb)) e
   where e ->> 'method' = 'password';
  if v_pw_at is null or v_pw_at < now() - p_window then
    return false;
  end if;
  select exists (
    select 1 from auth.mfa_factors f
     where f.user_id = (select auth.uid()) and f.status = 'verified'
  ) into v_has_mfa;
  if v_has_mfa and coalesce(v_jwt ->> 'aal', 'aal1') <> 'aal2' then
    return false;
  end if;
  return true;
end;
$$;

revoke execute on function private.hash_token(text), private.my_email(), private.recently_reauthenticated(interval)
  from public, anon, authenticated;

---------------------------------------------------------------------------
-- create_invite: Owner invites Admin/Staff; Admin invites Staff only.
-- Returns the raw token ONCE (for the link); only its hash is stored.
---------------------------------------------------------------------------
create function public.create_invite(p_shop_id uuid, p_email text, p_role public.member_role)
returns table (invite_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_my_role public.member_role := private.my_role(p_shop_id);
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_token text;
  v_id uuid;
  v_expires timestamptz := now() + interval '72 hours';
begin
  if v_my_role is null or private.role_rank(v_my_role) < private.role_rank('admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_role = 'owner' then
    raise exception 'ownership can only be transferred' using errcode = '42501';
  end if;
  if private.role_rank(p_role) >= private.role_rank(v_my_role) then
    raise exception 'cannot invite a role equal to or above your own' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.memberships m join auth.users u on u.id = m.user_id
     where m.shop_id = p_shop_id and lower(u.email) = v_email
  ) then
    raise exception 'already a member' using errcode = '23505';
  end if;
  -- Rate limit (spec §4): at most 20 invites per shop per 24 hours.
  if (select count(*) from public.invites i
       where i.shop_id = p_shop_id and i.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'too many invites, try again tomorrow' using errcode = '54000';
  end if;
  -- A new invite replaces any pending one for the same address.
  update public.invites i set revoked_at = now()
   where i.shop_id = p_shop_id and i.email = v_email
     and i.used_at is null and i.revoked_at is null and i.expires_at > now();

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.invites (shop_id, email, role, token_hash, invited_by, expires_at)
  values (p_shop_id, v_email, p_role, private.hash_token(v_token), (select auth.uid()), v_expires)
  returning id into v_id;

  perform private.audit(p_shop_id, 'invite.created', 'invites', v_id, null,
    jsonb_build_object('email', v_email, 'role', p_role, 'expires_at', v_expires));
  return query select v_id, v_token, v_expires;
end;
$$;

---------------------------------------------------------------------------
-- invite_preview: what the invite link page shows before sign-in (shop name,
-- role, masked email). Callable by anon on purpose; the token is 256 random
-- bits, so it can't be guessed. Reveals nothing for invalid tokens.
---------------------------------------------------------------------------
create function public.invite_preview(p_token text)
returns table (shop_name text, role public.member_role, email_hint text, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.invites;
  v_shop text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return query select null::text, null::public.member_role, null::text, 'invalid'::text;
    return;
  end if;
  select * into v from public.invites i where i.token_hash = private.hash_token(p_token);
  if not found then
    return query select null::text, null::public.member_role, null::text, 'invalid'::text;
    return;
  end if;
  select s.name into v_shop from public.shops s where s.id = v.shop_id;
  return query select
    v_shop,
    v.role,
    left(v.email, 1) || '•••@' || split_part(v.email, '@', 2),
    case
      when v.revoked_at is not null then 'revoked'
      when v.used_at is not null then 'used'
      when v.expires_at <= now() then 'expired'
      else 'valid'
    end;
end;
$$;

---------------------------------------------------------------------------
-- accept_invite: verifies token, email match and expiry; creates the
-- membership; marks the invite used. One shop per user in the MVP.
---------------------------------------------------------------------------
create function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invites;
  v_uid uuid := (select auth.uid());
  v_membership uuid;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select * into v from public.invites i
   where i.token_hash = private.hash_token(coalesce(p_token, ''))
   for update;
  if not found then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;
  if v.revoked_at is not null then
    raise exception 'invite revoked' using errcode = '22023';
  end if;
  if v.used_at is not null then
    raise exception 'invite already used' using errcode = '22023';
  end if;
  if v.expires_at <= now() then
    raise exception 'invite expired' using errcode = '22023';
  end if;
  if private.my_email() is distinct from v.email then
    raise exception 'this invite is for a different email address' using errcode = '42501';
  end if;
  if exists (select 1 from public.memberships m where m.user_id = v_uid) then
    raise exception 'already a member of a shop' using errcode = '23505';
  end if;

  insert into public.memberships (shop_id, user_id, role)
  values (v.shop_id, v_uid, v.role)
  returning id into v_membership;
  update public.invites set used_at = now(), used_by = v_uid where id = v.id;

  perform private.audit(v.shop_id, 'member.joined', 'memberships', v_membership, null,
    jsonb_build_object('user_id', v_uid, 'role', v.role, 'invite_id', v.id));
  return v.shop_id;
end;
$$;

---------------------------------------------------------------------------
-- revoke_invite: Owner any invite; Admin only Staff invites.
---------------------------------------------------------------------------
create function public.revoke_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invites;
  v_my_role public.member_role;
begin
  select * into v from public.invites i where i.id = p_invite_id for update;
  if not found then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;
  v_my_role := private.my_role(v.shop_id);
  if v_my_role is null or private.role_rank(v_my_role) < private.role_rank('admin')
     or private.role_rank(v.role) >= private.role_rank(v_my_role) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v.used_at is not null or v.revoked_at is not null then
    return;
  end if;
  update public.invites set revoked_at = now() where id = v.id;
  perform private.audit(v.shop_id, 'invite.revoked', 'invites', v.id,
    jsonb_build_object('email', v.email, 'role', v.role), null);
end;
$$;

---------------------------------------------------------------------------
-- change_member_role: Owner only, between Admin and Staff. The Owner's own
-- role never changes here (only through transfer_ownership).
---------------------------------------------------------------------------
create function public.change_member_role(p_shop_id uuid, p_user_id uuid, p_role public.member_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.memberships;
begin
  if private.my_role(p_shop_id) is distinct from 'owner' then
    raise exception 'only the owner can change roles' using errcode = '42501';
  end if;
  if p_role = 'owner' then
    raise exception 'use transfer_ownership' using errcode = '42501';
  end if;
  select * into v_target from public.memberships m
   where m.shop_id = p_shop_id and m.user_id = p_user_id for update;
  if not found then
    raise exception 'not a member' using errcode = 'P0002';
  end if;
  if v_target.role = 'owner' then
    raise exception 'the owner cannot be demoted' using errcode = '42501';
  end if;
  if v_target.role = p_role then
    return;
  end if;
  update public.memberships set role = p_role where id = v_target.id;
  perform private.audit(p_shop_id, 'member.role_changed', 'memberships', v_target.id,
    jsonb_build_object('user_id', p_user_id, 'role', v_target.role),
    jsonb_build_object('user_id', p_user_id, 'role', p_role));
end;
$$;

---------------------------------------------------------------------------
-- remove_member: Owner removes Admin/Staff; Admin removes Staff. Never the
-- Owner, never yourself here. Access ends on the next request because every
-- policy reads memberships live.
---------------------------------------------------------------------------
create function public.remove_member(p_shop_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_my_role public.member_role := private.my_role(p_shop_id);
  v_target public.memberships;
begin
  if v_my_role is null or private.role_rank(v_my_role) < private.role_rank('admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'you cannot remove yourself' using errcode = '42501';
  end if;
  select * into v_target from public.memberships m
   where m.shop_id = p_shop_id and m.user_id = p_user_id for update;
  if not found then
    raise exception 'not a member' using errcode = 'P0002';
  end if;
  if v_target.role = 'owner' then
    raise exception 'the owner cannot be removed' using errcode = '42501';
  end if;
  if private.role_rank(v_target.role) >= private.role_rank(v_my_role) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.memberships where id = v_target.id;
  perform private.audit(p_shop_id, 'member.removed', 'memberships', v_target.id,
    jsonb_build_object('user_id', p_user_id, 'role', v_target.role), null);
end;
$$;

---------------------------------------------------------------------------
-- transfer_ownership: started by the Owner, who must have just re-entered
-- their password (and passed MFA if enrolled). Old Owner becomes Admin.
---------------------------------------------------------------------------
create function public.transfer_ownership(p_shop_id uuid, p_new_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_target public.memberships;
begin
  if private.my_role(p_shop_id) is distinct from 'owner' then
    raise exception 'only the owner can transfer ownership' using errcode = '42501';
  end if;
  if not private.recently_reauthenticated() then
    raise exception 'please confirm your password again' using errcode = '42501', hint = 'reauthentication_needed';
  end if;
  if p_new_owner_id = v_uid then
    return;
  end if;
  select * into v_target from public.memberships m
   where m.shop_id = p_shop_id and m.user_id = p_new_owner_id for update;
  if not found then
    raise exception 'the new owner must already be a member' using errcode = 'P0002';
  end if;
  -- Demote first: the one-owner index is checked row by row.
  update public.memberships set role = 'admin' where shop_id = p_shop_id and user_id = v_uid;
  update public.memberships set role = 'owner' where id = v_target.id;
  perform private.audit(p_shop_id, 'shop.ownership_transferred', 'shops', p_shop_id,
    jsonb_build_object('owner_id', v_uid),
    jsonb_build_object('owner_id', p_new_owner_id, 'previous_owner_role', 'admin'));
end;
$$;

revoke execute on function
  public.create_invite(uuid, text, public.member_role),
  public.invite_preview(text),
  public.accept_invite(text),
  public.revoke_invite(uuid),
  public.change_member_role(uuid, uuid, public.member_role),
  public.remove_member(uuid, uuid),
  public.transfer_ownership(uuid, uuid)
from public, anon, authenticated;
grant execute on function
  public.create_invite(uuid, text, public.member_role),
  public.invite_preview(text),
  public.accept_invite(text),
  public.revoke_invite(uuid),
  public.change_member_role(uuid, uuid, public.member_role),
  public.remove_member(uuid, uuid),
  public.transfer_ownership(uuid, uuid)
to authenticated;
-- The invite page shows shop name and role before the invitee has an account.
grant execute on function public.invite_preview(text) to anon;
