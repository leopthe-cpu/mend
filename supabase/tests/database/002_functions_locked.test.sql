-- Functions are executable by PUBLIC by default in Postgres. Nothing we write
-- may be callable by anon, and only allow-listed helpers by authenticated.
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

-- Our own functions only: skip anything owned by an extension.
create temporary view our_functions as
  select p.oid, n.nspname, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and not exists (select 1 from pg_depend d
                      where d.objid = p.oid and d.deptype = 'e');

-- anon: only the invite preview (the invite page before sign-in).
select is_empty(
  $$ select nspname || '.' || proname from our_functions
      where has_function_privilege('anon', oid, 'EXECUTE')
        and nspname || '.' || proname <> all (array['public.invite_preview']) $$,
  'anon can execute only allow-listed functions'
);

-- Extend this allow-list deliberately when a helper must be callable by users
-- (e.g. RLS helpers and RPCs in Phase 1B).
select is_empty(
  $$ select nspname || '.' || proname from our_functions
      where has_function_privilege('authenticated', oid, 'EXECUTE')
        and nspname || '.' || proname <> all (array[
          -- RLS helpers (policies run as the caller)
          'private.role_rank', 'private.my_shop_ids', 'private.my_role',
          'private.has_role', 'private.my_coworker_ids',
          -- RPCs: each checks the caller's role itself
          'public.create_shop', 'public.create_invite', 'public.invite_preview',
          'public.accept_invite', 'public.revoke_invite', 'public.change_member_role',
          'public.remove_member', 'public.transfer_ownership'
        ]) $$,
  'authenticated can execute only allow-listed functions'
);

select * from finish();
rollback;
