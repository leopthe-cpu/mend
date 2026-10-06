-- Baseline security posture for every later migration.
--
-- Why: the browser talks to Postgres directly through the Data API, so the
-- database itself is the security boundary (docs/spec.md §3, §4). We start
-- from "nothing is reachable" and every migration grants exactly what it needs.

-- `private` holds security-definer helpers used by RLS policies and triggers.
-- It is NOT in the Data API's exposed schemas (supabase/config.toml [api].schemas),
-- so nothing here can be called as an RPC. Supabase docs: security-definer
-- functions must never live in an exposed schema.
create schema if not exists private;
revoke all on schema private from public, anon;
-- Policies run as the calling role, so `authenticated` needs USAGE to call
-- helper functions that are explicitly granted to it (none yet).
grant usage on schema private to authenticated;

-- Postgres makes every new function executable by PUBLIC by default, and
-- Supabase's default privileges also grant new tables/functions in `public` to
-- the API roles. Remove both so a forgotten GRANT fails closed, not open.
-- (Applies to objects created later by `postgres`, i.e. by our migrations.)
--
-- The PUBLIC execute grant is a built-in *global* default: Postgres only lets
-- you remove it with a global (no `in schema`) ALTER DEFAULT PRIVILEGES —
-- per-schema entries can only add privileges. Verified locally: without this
-- line a new function in `public` stayed executable by anon.
alter default privileges for role postgres
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- Shared trigger function: keeps updated_at honest without trusting the client.
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function private.set_updated_at() from public, anon, authenticated;
