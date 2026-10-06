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

select is_empty(
  $$ select nspname || '.' || proname from our_functions
      where has_function_privilege('anon', oid, 'EXECUTE') $$,
  'anon cannot execute any function in public or private'
);

-- Extend this allow-list deliberately when a helper must be callable by users
-- (e.g. RLS helpers and RPCs in Phase 1B).
select is_empty(
  $$ select nspname || '.' || proname from our_functions
      where has_function_privilege('authenticated', oid, 'EXECUTE')
        and nspname || '.' || proname <> all (array[]::text[]) $$,
  'authenticated can execute only allow-listed functions'
);

select * from finish();
rollback;
