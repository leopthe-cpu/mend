-- Phase 1B: tenancy core (docs/spec.md §5, §6; addendum §7).
-- A shop is the tenant. Users belong to shops through memberships with exactly
-- one role. Every policy checks membership through the helpers below, which
-- read `memberships` at query time, so removing a membership cuts access on
-- the very next request (spec §4).

create type public.member_role as enum ('owner', 'admin', 'staff');
create type public.shop_vertical as enum ('electronics', 'ski', 'tailoring', 'other');

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  vertical public.shop_vertical not null,
  country text not null check (country in ('CA', 'US')),
  currency text not null check (currency in ('CAD', 'USD')),
  time_zone text not null,
  address text check (char_length(address) <= 500),
  phone text check (char_length(phone) <= 40),
  email text check (char_length(email) <= 254),
  business_hours jsonb not null default '{}'::jsonb,
  logo_path text,
  tax_registration_number text check (char_length(tax_registration_number) <= 60),
  terms_text text check (char_length(terms_text) <= 10000),
  -- Server-managed counters and limits: never client-writable (see grants).
  next_ticket_number integer not null default 1001,
  next_invoice_number integer not null default 1001,
  sms_monthly_cap integer not null default 500,
  unclaimed_reminder_days integer not null default 7 check (unclaimed_reminder_days between 1 and 365),
  quiet_hours_start time not null default '21:00',
  quiet_hours_end time not null default '08:00',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, user_id)
);
-- Exactly one owner per shop (at most one here; create_shop guarantees one).
create unique index memberships_one_owner_per_shop on public.memberships (shop_id) where role = 'owner';
create index memberships_user_id_idx on public.memberships (user_id);

create trigger shops_set_updated_at before update on public.shops
  for each row execute function private.set_updated_at();
create trigger memberships_set_updated_at before update on public.memberships
  for each row execute function private.set_updated_at();

-- Append-only audit trail (spec §4 "Audit log").
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id uuid,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_shop_created_idx on public.audit_log (shop_id, created_at desc);

-- No one may rewrite history, not even through a definer function. (Rows go
-- away only when the whole shop is deleted: cascades are allowed below.)
create function private.audit_log_is_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'audit_log is append-only' using errcode = '42501';
  end if;
  -- DELETE: only allowed as part of deleting the shop itself.
  if exists (select 1 from public.shops s where s.id = old.shop_id) then
    raise exception 'audit_log is append-only' using errcode = '42501';
  end if;
  return old;
end;
$$;
create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function private.audit_log_is_append_only();

---------------------------------------------------------------------------
-- RLS helpers. SECURITY DEFINER so they can read memberships without
-- recursing through memberships' own RLS; in the non-exposed `private`
-- schema; empty search_path; called from policies as (select ...) so they run
-- once per statement (Supabase RLS performance guide).
---------------------------------------------------------------------------

create function private.role_rank(r public.member_role)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case r when 'owner' then 3 when 'admin' then 2 when 'staff' then 1 end;
$$;

create function private.my_shop_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.shop_id), '{}')
  from public.memberships m
  where m.user_id = (select auth.uid());
$$;

create function private.my_role(p_shop_id uuid)
returns public.member_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.memberships m
  where m.shop_id = p_shop_id and m.user_id = (select auth.uid());
$$;

create function private.has_role(p_shop_id uuid, p_min public.member_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.role_rank(private.my_role(p_shop_id)) >= private.role_rank(p_min), false);
$$;

-- Users who share at least one shop with the caller (for reading names).
create function private.my_coworker_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct m.user_id), '{}')
  from public.memberships m
  where m.shop_id = any (private.my_shop_ids());
$$;

-- Internal: write an audit row. Not callable by clients.
create function private.audit(
  p_shop_id uuid,
  p_action text,
  p_entity text,
  p_entity_id uuid,
  p_old jsonb default null,
  p_new jsonb default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (shop_id, actor_id, action, entity, entity_id, old_values, new_values)
  values (p_shop_id, (select auth.uid()), p_action, p_entity, p_entity_id, p_old, p_new);
$$;

-- Generic row-change audit for settings-like tables (attach per table).
create function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Read through jsonb so the same function works for every table (shops has
  -- no shop_id column: its own id is the shop).
  v_row jsonb := coalesce(to_jsonb(new), to_jsonb(old));
  v_shop uuid := coalesce(
    (v_row ->> 'shop_id')::uuid,
    case when tg_table_name = 'shops' then (v_row ->> 'id')::uuid end
  );
  v_id uuid := (v_row ->> 'id')::uuid;
begin
  -- Skip when the shop itself is being deleted (cascade).
  if tg_op = 'DELETE' and not exists (select 1 from public.shops where id = v_shop) then
    return old;
  end if;
  perform private.audit(
    v_shop,
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    v_id,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

revoke execute on function
  private.role_rank(public.member_role),
  private.my_shop_ids(),
  private.my_role(uuid),
  private.has_role(uuid, public.member_role),
  private.my_coworker_ids(),
  private.audit(uuid, text, text, uuid, jsonb, jsonb),
  private.audit_row_change(),
  private.audit_log_is_append_only()
from public, anon, authenticated;
-- Policies run as the caller, so these four must be executable by users.
grant execute on function
  private.role_rank(public.member_role),
  private.my_shop_ids(),
  private.my_role(uuid),
  private.has_role(uuid, public.member_role),
  private.my_coworker_ids()
to authenticated;

---------------------------------------------------------------------------
-- RLS
---------------------------------------------------------------------------

alter table public.shops enable row level security;
alter table public.memberships enable row level security;
alter table public.audit_log enable row level security;

-- shops: members read; Owner/Admin edit profile fields (column grants);
-- created only by create_shop(), deleted only by a future Owner-only flow.
grant select on public.shops to authenticated;
grant update (
  name, address, phone, email, business_hours, time_zone, currency,
  tax_registration_number, terms_text, unclaimed_reminder_days,
  quiet_hours_start, quiet_hours_end
) on public.shops to authenticated;

create policy shops_select_members on public.shops
  for select to authenticated
  using (id = any ((select private.my_shop_ids())::uuid[]));

create policy shops_update_admins on public.shops
  for update to authenticated
  using ((select private.has_role(id, 'admin')))
  with check ((select private.has_role(id, 'admin')));

-- memberships: members of a shop see its roster. All writes go through RPCs.
grant select on public.memberships to authenticated;
create policy memberships_select_same_shop on public.memberships
  for select to authenticated
  using (shop_id = any ((select private.my_shop_ids())::uuid[]));

-- audit_log: Owner and Admin read; nobody writes directly.
grant select on public.audit_log to authenticated;
create policy audit_log_select_admins on public.audit_log
  for select to authenticated
  using ((select private.has_role(shop_id, 'admin')));

-- profiles: now also readable by coworkers (names on the team page).
drop policy profiles_select_own on public.profiles;
create policy profiles_select_self_or_coworker on public.profiles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or user_id = any ((select private.my_coworker_ids())::uuid[])
  );

-- Validate shop fields that a CHECK can't (time zone must exist).
create function private.validate_shop()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.time_zone) then
    raise exception 'invalid time zone: %', new.time_zone using errcode = '22023';
  end if;
  if new.email is not null and new.email <> '' and new.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid shop email' using errcode = '22023';
  end if;
  new.name := btrim(new.name);
  return new;
end;
$$;
revoke execute on function private.validate_shop() from public, anon, authenticated;
create trigger shops_validate before insert or update on public.shops
  for each row execute function private.validate_shop();

-- Settings changes on the shop are audited (old and new values).
create trigger shops_audit after update on public.shops
  for each row execute function private.audit_row_change();
