-- New-ticket refinements (UX plan v2, PR 6b, 15 Oct): Admin-typed services
-- are saved to the catalog atomically (a later failure rolls the save back),
-- duplicate names re-use the existing item, staff are refused, and line
-- taxes are stored on the new catalog item.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('a7000000-0000-0000-0000-000000000001', 'owner@h.test', now(), '{}'),
  ('a7000000-0000-0000-0000-000000000003', 'staff@h.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated;

select set_config('request.jwt.claims', '{"sub":"a7000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('H Services', null, 'other', 'CA', null, 'America/Toronto',
  null, null, null, '{}', '[{"name":"HST","rate":13}]')::text);
insert into t select 'hst', id::text from public.tax_rates where shop_id = pg_temp.v('shop');
with x as (insert into public.catalog_items (shop_id, name, item_type, unit, price_cents)
  values (pg_temp.v('shop'), 'Polish', 'service', 'each', 3000) returning id)
insert into t select 'polish', id::text from x;
insert into t values ('cust', public.save_customer(pg_temp.v('shop'), null, 'Tom', '4165550200')::text);
reset role;
-- Team members are added by the superuser here (invites are tested elsewhere).
insert into public.memberships (shop_id, user_id, role) values
  (pg_temp.v('shop'), 'a7000000-0000-0000-0000-000000000003', 'staff');

-- ===== Atomicity: a failure after save_catalog_item rolls everything back ===
select set_config('request.jwt.claims', '{"sub":"a7000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select * from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'),
  'Atomic fail', null, null, null, '{}', null, false,
  '[{"name":"FailMe","quantity":1,"price_cents":1000,"discount_type":"percent","discount_value":200}]') $$,
  '22023', null, 'a discount above 100% is refused');
select is((select count(*)::int from public.catalog_items where shop_id = pg_temp.v('shop') and name = 'FailMe'),
  0, 'a failed ticket leaves no catalog item behind');
select is((select count(*)::int from public.tickets where shop_id = pg_temp.v('shop')), 0,
  'and no ticket');
reset role;

-- ===== Duplicate name: a typed name matching an existing item re-uses it ====
select set_config('request.jwt.claims', '{"sub":"a7000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t select 'dup', ticket_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'),
  'Shine', null, null, null, '{}', null, false,
  ('[{"name":" polish ","quantity":1,"price_cents":8888,"discount_type":"fixed","discount_value":5}]')::jsonb);
select is((select count(*)::int from public.catalog_items where shop_id = pg_temp.v('shop') and lower(btrim(name)) = 'polish'),
  1, 'the existing Polish item is re-used, not duplicated');
select is((select price_cents from public.catalog_items where id = pg_temp.v('polish')), 3000::bigint,
  'the existing catalog price is kept (the typed price is ignored)');
select is((select count(*)::int from public.estimate_line_items l
             join public.estimates e on e.id = l.estimate_id where e.ticket_id = pg_temp.v('dup')),
  1, 'the estimate still gets a line');
reset role;

-- ===== A new service with taxes stores them on the catalog item ============
select set_config('request.jwt.claims', '{"sub":"a7000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t select 'taxed', ticket_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'),
  'Wax', null, null, null, '{}', null, false,
  ('[{"name":"Wax","quantity":1,"price_cents":2000,"tax_rate_ids":["' || pg_temp.v('hst') || '"]}]')::jsonb);
select is((select count(*)::int from public.catalog_item_tax_rates
             where catalog_item_id = (select id from public.catalog_items
               where shop_id = pg_temp.v('shop') and name = 'Wax')),
  1, 'the new catalog item picks up the line tax');
select is((select count(*)::int from public.catalog_items where shop_id = pg_temp.v('shop') and name = 'Wax'),
  1, 'Wax is in the catalog');
reset role;

-- ===== Staff cannot add a new catalog service ==============================
select set_config('request.jwt.claims', '{"sub":"a7000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select * from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'),
  'Nope', null, null, null, '{}', null, false, '[{"name":"Nope","price_cents":100}]') $$,
  '42501', null, 'a team member cannot add a new catalog service');
reset role;

select * from finish();
rollback;
