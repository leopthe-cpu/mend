-- Guard for every future migration: the public schema must stay locked down.
-- docs/spec.md §4 "RLS enabled on every table in the public schema, with no
-- exceptions" and "No table is readable by the anon role".
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select is_empty(
  $$ select c.relname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and not c.relrowsecurity $$,
  'every table in public has RLS enabled'
);

select is_empty(
  $$ select c.relname || ':' || p.privilege_type
       from information_schema.role_table_grants p
       join pg_class c on c.relname = p.table_name
       join pg_namespace n on n.oid = c.relnamespace and n.nspname = p.table_schema
      where p.table_schema = 'public' and p.grantee in ('anon', 'PUBLIC') $$,
  'anon and PUBLIC have no table privileges in public'
);

-- Views bypass RLS unless created with security_invoker.
select is_empty(
  $$ select c.relname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('v', 'm')
        and not coalesce(c.reloptions @> array['security_invoker=true'], false) $$,
  'no views in public that bypass RLS'
);

select is_empty(
  $$ select n.nspname
       from pg_namespace n
      where n.nspname = 'private'
        and has_schema_privilege('anon', n.oid, 'USAGE') $$,
  'anon cannot use the private schema'
);

select * from finish();
rollback;
