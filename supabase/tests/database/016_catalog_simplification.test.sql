-- Catalog simplification (UX plan v2, PR 4, 15 Oct): items are only Service
-- and Part. The one-time UPDATE that converted existing labour rows ran with
-- the migration (on an empty test database), so this file pins the observable
-- guarantees: new shops seed "Labor" as a Service, save_catalog_item refuses
-- labour, the `labor` enum value is kept for old data, and the Admin-only
-- check still holds.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('c1000000-0000-0000-0000-000000000001', 'owner@c.test', now(), '{}'),
  ('c1000000-0000-0000-0000-000000000002', 'admin@c.test', now(), '{}'),
  ('c1000000-0000-0000-0000-000000000003', 'staff@c.test', now(), '{}'),
  ('c2000000-0000-0000-0000-000000000001', 'owner@d.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated;

-- ===== New shops: the shared starter item is a Service, sold per hour ======
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('C Catalog', null, 'other', 'CA', null, 'America/Toronto')::text);
reset role;
select set_config('request.jwt.claims', '{"sub":"c2000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop_e', public.create_shop('E Catalog', null, 'other', 'CA', null, 'America/Toronto')::text);
reset role;

select is((select item_type::text from public.catalog_items where shop_id = pg_temp.v('shop') and name = 'Labor'),
  'service', 'the seeded Labor item is a Service');
select is((select unit::text from public.catalog_items where shop_id = pg_temp.v('shop') and name = 'Labor'),
  'hour', 'and it is still sold per hour');
select lives_ok($$ select 'labor'::public.catalog_item_type $$, 'the labor enum value is kept for old data');

insert into public.memberships (shop_id, user_id, role) values
  (pg_temp.v('shop'), 'c1000000-0000-0000-0000-000000000002', 'admin'),
  (pg_temp.v('shop'), 'c1000000-0000-0000-0000-000000000003', 'staff');

-- ===== Admins can save Service and Part items =============================
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('svc', public.save_catalog_item(pg_temp.v('shop'), null, 'Tune-up', null, 'service', 'each', 5000)::text);
insert into t values ('part', public.save_catalog_item(pg_temp.v('shop'), null, 'Strap', null, 'part', 'each', 2000)::text);
select is((select item_type::text from public.catalog_items where id = pg_temp.v('svc')), 'service', 'an admin saves a service');
select is((select item_type::text from public.catalog_items where id = pg_temp.v('part')), 'part', 'an admin saves a part');
reset role;

-- ===== save_catalog_item refuses labour, for create and update ============
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.save_catalog_item(pg_temp.v('shop'), null, 'Hourly', null, 'labor', 'hour', 1000) $$,
  '22023', null, 'creating a labour item is refused');
select throws_ok($$ select public.save_catalog_item(pg_temp.v('shop'), pg_temp.v('svc'), 'Tune-up', null, 'labor', 'hour', 5000) $$,
  '22023', null, 'changing an item to labour is refused');
reset role;

-- ===== The Admin-only check still holds ====================================
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.save_catalog_item(pg_temp.v('shop'), null, 'Nope', null, 'service', 'each', 100) $$,
  '42501', null, 'a team member cannot change the catalog');
select throws_ok($$ insert into public.catalog_items (shop_id, name, item_type, price_cents)
  values (pg_temp.v('shop'), 'Nope', 'part', 100) $$, '42501', null, 'a team member cannot add items directly');
reset role;

select set_config('request.jwt.claims', '{"sub":"c2000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.save_catalog_item(pg_temp.v('shop'), null, 'X', null, 'part', 'each', 100) $$,
  '42501', null, 'another shop''s owner cannot change the catalog');
reset role;

select * from finish();
rollback;
