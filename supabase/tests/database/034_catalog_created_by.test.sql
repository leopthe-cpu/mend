-- "Added by" on catalog items is set by the database and can't be rewritten (decision 106).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('b1000000-0000-0000-0000-0000000000d1', 'owner@cat.test', now(), '{}'),
  ('b1000000-0000-0000-0000-0000000000d2', 'someone@cat.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated;

select set_config('request.jwt.claims', '{"sub":"b1000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('Catalog Shop', null, 'other', 'CA', null, 'America/Toronto')::text);
insert into t values ('item', public.save_catalog_item(pg_temp.v('shop'), null, 'Hem', null, 'service', 'each', 1800)::text);
select is((select created_by from public.catalog_items where id = pg_temp.v('item')),
  'b1000000-0000-0000-0000-0000000000d1'::uuid, 'the person who adds an item is recorded');
update public.catalog_items set created_by = 'b1000000-0000-0000-0000-0000000000d2', price_cents = 2000
 where id = pg_temp.v('item');
select results_eq($$ select created_by, price_cents from public.catalog_items where id = pg_temp.v('item') $$,
  $$ values ('b1000000-0000-0000-0000-0000000000d1'::uuid, 2000::bigint) $$,
  'an update can change the price but not who added it');
insert into public.catalog_items (shop_id, name, item_type, created_by)
  values (pg_temp.v('shop'), 'Zip', 'part', 'b1000000-0000-0000-0000-0000000000d2');
select is((select created_by from public.catalog_items where name = 'Zip' and shop_id = pg_temp.v('shop')),
  'b1000000-0000-0000-0000-0000000000d1'::uuid, 'a direct insert records the signed-in person, not what was sent');
reset role;

select * from finish();
rollback;
