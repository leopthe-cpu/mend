-- New-ticket fixes (decision 80): pricing a $0 catalog item on the ticket
-- (Owner/Admin only) and the message for a discount on $0 services.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('aa000000-0000-0000-0000-000000000001', 'owner@ntf.test', now(), '{}'),
  ('aa000000-0000-0000-0000-000000000003', 'staff@ntf.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated;

select set_config('request.jwt.claims', '{"sub":"aa000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('NTF Repairs', null, 'other', 'CA', null, 'America/Toronto')::text);
insert into t values ('cust', public.save_customer(pg_temp.v('shop'), null, 'Tom', '4165550500')::text);
reset role;
with x as (insert into public.catalog_items (shop_id, name, item_type, unit, price_cents)
  values (pg_temp.v('shop'), 'Labor', 'labor', 'hour', 0) returning id)
insert into t select 'labor', id::text from x;
insert into public.memberships (shop_id, user_id, role) values
  (pg_temp.v('shop'), 'aa000000-0000-0000-0000-000000000003', 'staff');
create function pg_temp.line(p_price bigint) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('catalog_item_id', pg_temp.v('labor'), 'quantity', 2, 'price_cents', p_price)) $$;
grant execute on function pg_temp.line(bigint) to authenticated;

set local role authenticated;
select throws_like($$ select * from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'), 'Zero',
  p_lines => pg_temp.line(0),
  p_discount => '{"type": "percent", "value": 10}') $$,
  '%no price yet%', 'a discount on $0 services says why it is refused');
insert into t select 'e', estimate_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'),
  'Two hours', p_lines => pg_temp.line(4500));
reset role;
select is((select unit_price_cents from public.estimate_line_items where estimate_id = pg_temp.v('e')), 4500::bigint,
  'the owner prices the $0 catalog item');
select is((select total_cents from public.estimates where id = pg_temp.v('e')), 9000::bigint, '2 hours × $45');
select ok(exists (select 1 from public.audit_log where action = 'estimate_line.price_override'), 'the override is audited');
select is((select price_cents from public.catalog_items where id = pg_temp.v('labor')), 0::bigint,
  'the catalog price is unchanged');

select set_config('request.jwt.claims', '{"sub":"aa000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select * from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'), 'Staff price',
  p_lines => pg_temp.line(4500)) $$, '42501', null, 'staff cannot set a price');
select lives_ok($$ select * from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'), 'Staff no price',
  p_lines => pg_temp.line(0)) $$, 'staff sending the catalog price is fine');
reset role;

select * from finish();
rollback;
