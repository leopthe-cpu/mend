-- New-ticket flow (UX plan v2, PR 6, decision 69): create_ticket_full does the
-- whole intake in one transaction; promised_date_counts feeds the calendar.
-- PR 6b (15 Oct): Admin-typed services are saved to the catalog; payment
-- method is always 'other' (the new dropdown has no method picker).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('f1000000-0000-0000-0000-000000000001', 'owner@f.test', now(), '{}'),
  ('f1000000-0000-0000-0000-000000000003', 'staff@f.test', now(), '{}'),
  ('f2000000-0000-0000-0000-000000000001', 'owner@g.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated;

-- Shop F with 13% HST, a taxed catalog item and a customer.
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('F Shoes', null, 'other', 'CA', null, 'America/Toronto',
  null, null, null, '{}', '[{"name":"HST","rate":13}]')::text);
insert into t select 'hst', id::text from public.tax_rates where shop_id = pg_temp.v('shop');
with x as (insert into public.catalog_items (shop_id, name, item_type, unit, price_cents)
  values (pg_temp.v('shop'), 'Resole', 'service', 'each', 9000) returning id)
insert into t select 'resole', id::text from x;
insert into public.catalog_item_tax_rates (shop_id, catalog_item_id, tax_rate_id)
  values (pg_temp.v('shop'), pg_temp.v('resole'), pg_temp.v('hst'));
insert into t values ('cust', public.save_customer(pg_temp.v('shop'), null, 'Maria', '4165550100')::text);

-- 1) No pricing at all: a ticket with just a description.
insert into t select 'plain', ticket_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'),
  'Brown boots need new heels and a full polish please');
select is((select item_name from public.tickets where id = pg_temp.v('plain')),
  'Brown boots need new heels and', 'a blank title is the first six words of the description');
select is((select count(*)::int from public.estimates where ticket_id = pg_temp.v('plain')), 0,
  'no lines means no estimate');
select is((select count(*)::int from public.payments where ticket_id = pg_temp.v('plain')), 0,
  'no payment unless asked');
select throws_ok($$ select * from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'), '  ') $$,
  '22023', null, 'a ticket needs a description or a title');
insert into t select 'titled', ticket_id::text
  from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'), 'Zip repair', 'Winter coat');
select is((select item_name from public.tickets where id = pg_temp.v('titled')), 'Winter coat',
  'a typed title is kept');

-- 2) Owner: catalog line + typed service with a 10% discount, paid in full.
--    PR 6b: the typed service "Dye" is saved to the catalog as service/each.
insert into t select 'full', ticket_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'),
  'Resole and dye', null, null, null, '{}', null, false,
  ('[{"catalog_item_id":"' || pg_temp.v('resole') || '","quantity":1},
    {"name":"Dye","quantity":1,"price_cents":5000,"discount_type":"percent","discount_value":10}]')::jsonb,
  '{"full":true,"method":"card"}');
-- 9000 + 13% HST (1170) + 5000 - 10% (4500) = 14670
select is((select e.total_cents from public.estimates e where e.ticket_id = pg_temp.v('full')), 14670::bigint,
  'the estimate total includes catalog tax and the custom line discount');
select is((select array_agg(name_snapshot order by position) from public.estimate_line_items l
             join public.estimates e on e.id = l.estimate_id where e.ticket_id = pg_temp.v('full')),
  array['Resole', 'Dye'], 'both lines are on the draft estimate, in order');
-- PR 6b: a typed service is saved to the catalog.
select is((select count(*)::int from public.catalog_items where shop_id = pg_temp.v('shop') and name = 'Dye'), 1,
  'a typed service is saved to the catalog');
select is((select item_type::text from public.catalog_items where shop_id = pg_temp.v('shop') and name = 'Dye'),
  'service', 'saved as a Service');
select is((select unit::text from public.catalog_items where shop_id = pg_temp.v('shop') and name = 'Dye'),
  'each', 'saved as each');
-- PR 6b: payment method is always 'other' (no method picker).
select results_eq($$ select kind::text, method::text, amount_cents from public.payments where ticket_id = pg_temp.v('full') $$,
  $$ values ('payment', 'other', 14670::bigint) $$, 'paid in full records the whole total');

select throws_ok($$ select * from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'), 'No price',
  null, null, null, '{}', null, false, '[]', '{"full":true,"method":"cash"}') $$,
  '22023', null, 'paid in full needs a price');
select throws_ok($$ select * from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'), 'Too much',
  null, null, null, '{}', null, false,
  ('[{"catalog_item_id":"' || pg_temp.v('resole') || '"}]')::jsonb, '{"amount_cents":20000,"method":"cash"}') $$,
  '22023', null, 'a deposit can''t be more than the total');
reset role;

insert into public.memberships (shop_id, user_id, role) values
  (pg_temp.v('shop'), 'f1000000-0000-0000-0000-000000000003', 'staff');

-- 3) Team member: catalog lines and a deposit are fine; new services and
--    discounts are Admin-only (PR 6b: the 42501 now comes from
--    create_ticket_full itself, not add_custom_line), and a refusal saves
--    nothing.
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
insert into t select 'staff', ticket_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'),
  'Resole', null, null, null, '{}', null, false,
  ('[{"catalog_item_id":"' || pg_temp.v('resole') || '","quantity":2}]')::jsonb, '{"amount_cents":2000,"method":"cash"}');
select results_eq($$ select kind::text, amount_cents from public.payments where ticket_id = pg_temp.v('staff') $$,
  $$ values ('deposit', 2000::bigint) $$, 'a team member can take a deposit');
insert into t select 'before', count(*)::text from public.tickets where shop_id = pg_temp.v('shop');
select throws_ok($$ select * from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'), 'Custom',
  null, null, null, '{}', null, false, '[{"name":"Odd job","price_cents":1000}]') $$,
  '42501', null, 'a team member cannot add a new catalog service');
select throws_ok($$ select * from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'), 'Discount',
  null, null, null, '{}', null, false,
  ('[{"catalog_item_id":"' || pg_temp.v('resole') || '","discount_type":"fixed","discount_value":5}]')::jsonb) $$,
  '42501', null, 'a team member cannot add a discount');
select is((select count(*)::text from public.tickets where shop_id = pg_temp.v('shop')),
  (select v from t where k = 'before'), 'a refused intake leaves no ticket behind');
reset role;

-- 4) Promised-date counts: open tickets only, staff can read, outsiders can't.
update public.tickets set promised_date = '2026-11-10' where id in (pg_temp.v('plain'), pg_temp.v('full'), pg_temp.v('staff'));
update public.tickets set picked_up_at = now() where id = pg_temp.v('full');
update public.tickets set promised_date = '2026-11-12' where shop_id = pg_temp.v('shop') and promised_date is null;
update public.tickets set deleted_at = now()
 where shop_id = pg_temp.v('shop') and promised_date = '2026-11-12';

select set_config('request.jwt.claims', '{"sub":"f1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select day, open_tickets from public.promised_date_counts(pg_temp.v('shop'), '2026-11-01', '2026-11-30') $$,
  $$ values ('2026-11-10'::date, 2) $$, 'counts skip picked-up and deleted tickets');
select throws_ok($$ select * from public.promised_date_counts(pg_temp.v('shop'), '2026-01-01', '2026-12-31') $$,
  '22023', null, 'the range is capped at about two months');
reset role;

select set_config('request.jwt.claims', '{"sub":"f2000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select * from public.promised_date_counts(pg_temp.v('shop'), '2026-11-01', '2026-11-30') $$,
  '42501', null, 'another shop can''t read the counts');
reset role;

select * from finish();
rollback;
