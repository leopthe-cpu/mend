-- Per-user profile (docs/spec.md §6). One row per auth user, created by a
-- trigger so the client never inserts it. Users can read and rename only
-- their own row in 1A; shop members will be able to see each other's names
-- once memberships exist (Phase 1B).

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Column-level grant: the client may change full_name and nothing else.
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- No insert/delete policies or grants: rows come from the trigger below and
-- go away with the auth user (on delete cascade).

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- Runs as the function owner because the inserting role (Supabase Auth's
-- supabase_auth_admin) has no rights on public.profiles. search_path is empty
-- so every name is schema-qualified and can't be hijacked.
-- full_name comes from signup metadata, which the user controls: it is only a
-- display name, never used for authorization.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, full_name)
  values (
    new.id,
    left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 200)
  );
  return new;
end;
$$;
revoke execute on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
