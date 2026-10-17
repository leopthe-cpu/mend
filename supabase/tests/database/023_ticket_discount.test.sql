-- Whole-ticket discount (decision 78): math, tax share per rate, clamping,
-- permissions, revisions and create_ticket_full.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('a8000000-0000-0000-0000-000000000001', 'owner@td.test', now(), '{}'),
  ('a8000000-0000-0000-0000-000000000003', 'staff@td.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated;
create function pg_temp.est(p uuid) returns public.estimates language sql as $$ select * from public.estimates where id = p $$;
grant execute on function pg_temp.est(uuid) to authenticated;

select set_config('request.jwt.claims', '{"sub":"a8000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('TD Repairs', null, 'other', 'CA', null, 'America/Toronto',
  null, null, null, '{}', '[{"name":"GST","rate":5},{"name":"PST","rate":7}]')::text);
insert into t values ('cust', public.save_customer(pg_temp.v('shop'), null, 'Tess', '4165550300')::text);
reset role;
insert into t select 'gst', id::text from public.tax_rates where shop_id = pg_temp.v('shop') and name = 'GST';
insert into t select 'pst', id::text from public.tax_rates where shop_id = pg_temp.v('shop') and name = 'PST';
-- A: $30 with GST and PST. B: $10 with GST only.
with x as (insert into public.catalog_items (shop_id, name, item_type, unit, price_cents)
  values (pg_temp.v('shop'), 'Resole', 'service', 'each', 3000) returning id)
insert into t select 'a', id::text from x;
with x as (insert into public.catalog_items (shop_id, name, item_type, unit, price_cents)
  values (pg_temp.v('shop'), 'Laces', 'service', 'each', 1000) returning id)
insert into t select 'b', id::text from x;
insert into public.catalog_item_tax_rates (shop_id, catalog_item_id, tax_rate_id) values
  (pg_temp.v('shop'), pg_temp.v('a'), pg_temp.v('gst')),
  (pg_temp.v('shop'), pg_temp.v('a'), pg_temp.v('pst')),
  (pg_temp.v('shop'), pg_temp.v('b'), pg_temp.v('gst'));
insert into public.memberships (shop_id, user_id, role) values
  (pg_temp.v('shop'), 'a8000000-0000-0000-0000-000000000003', 'staff');
-- Texts need the shop's address and phone (decision 76).
update public.shops set address = '1 Main St, Toronto ON', phone = '416 555 0000';
create function pg_temp.lines() returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('catalog_item_id', pg_temp.v('a'), 'quantity', 1),
                           jsonb_build_object('catalog_item_id', pg_temp.v('b'), 'quantity', 1)) $$;
grant execute on function pg_temp.lines() to authenticated;

-- ===== create_ticket_full with 10% off, paid in full ==========================
set local role authenticated;
insert into t select 'e1', estimate_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'),
  'New soles', p_lines => pg_temp.lines(), p_payment => '{"full": true}',
  p_discount => '{"type": "percent", "value": 10}');
reset role;
-- Lines $40. 10% = $4. GST on 4000-400 = 3600 → 180. PST on 3000-300 = 2700 → 189.
select is((pg_temp.est(pg_temp.v('e1'))).discount_cents, 400::bigint, '10% of $40 is $4');
select is((pg_temp.est(pg_temp.v('e1'))).savings_cents, 400::bigint, 'savings include the ticket discount');
select is((pg_temp.est(pg_temp.v('e1'))).subtotal_cents, 3600::bigint, 'subtotal is after the discount');
select is((pg_temp.est(pg_temp.v('e1'))).tax_cents, 369::bigint, 'each rate is taxed on its share after the discount');
select is((pg_temp.est(pg_temp.v('e1'))).total_cents, 3969::bigint, 'total');
select is((select amount_cents from public.payments p join public.estimates e on e.ticket_id = p.ticket_id
            where e.id = pg_temp.v('e1')), 3969::bigint, 'paid in full uses the discounted total');

-- ===== set_estimate_discount: fixed amount, limits, clamping ==================
set local role authenticated;
select lives_ok($$ select public.set_estimate_discount(pg_temp.v('e1'), 'fixed', 5) $$, 'owner sets $5 off');
reset role;
-- $5 off $40: GST 3500 → 175; PST 3000 - 375 = 2625 → 183.75 → 184.
select is((pg_temp.est(pg_temp.v('e1'))).tax_cents, 359::bigint, 'tax shares round half away from zero');
select is((pg_temp.est(pg_temp.v('e1'))).total_cents, 3859::bigint, 'total with $5 off');
select ok(exists (select 1 from public.audit_log where action = 'estimate.discount'
                   and entity_id = pg_temp.v('e1')), 'discount changes are audited');
set local role authenticated;
select throws_ok($$ select public.set_estimate_discount(pg_temp.v('e1'), 'fixed', 50) $$, '22023', null,
  'a fixed discount above the services is refused');
select throws_ok($$ select public.set_estimate_discount(pg_temp.v('e1'), 'percent', 101) $$, '22023', null,
  'a percent above 100 is refused');
select lives_ok($$ select public.remove_estimate_line(l.id) from public.estimate_line_items l
                    where l.estimate_id = pg_temp.v('e1') and l.name_snapshot = 'Resole' $$, 'remove the $30 line');
reset role;
select is((pg_temp.est(pg_temp.v('e1'))).total_cents, 525::bigint, '$10 - $5, GST on $5');
set local role authenticated;
select lives_ok($$ select public.set_estimate_discount(pg_temp.v('e1'), 'fixed', 10) $$, 'discount the whole $10');
select lives_ok($$ select public.remove_estimate_line(l.id) from public.estimate_line_items l
                    where l.estimate_id = pg_temp.v('e1') $$, 'remove the last line');
reset role;
select is((pg_temp.est(pg_temp.v('e1'))).discount_cents, 0::bigint, 'the discount is clamped to the lines');
select is((pg_temp.est(pg_temp.v('e1'))).total_cents, 0::bigint, 'nothing left to pay for');

-- ===== Permissions and guards =================================================
select set_config('request.jwt.claims', '{"sub":"a8000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select * from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'), 'Staff try',
  p_lines => pg_temp.lines(), p_discount => '{"type": "percent", "value": 10}') $$, '42501', null,
  'staff cannot add a ticket discount');
insert into t select 'e2', estimate_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'),
  'Staff ticket', p_lines => pg_temp.lines());
select throws_ok($$ select public.set_estimate_discount(pg_temp.v('e2'), 'percent', 10) $$, '42501', null,
  'staff cannot set one later');
reset role;
select set_config('request.jwt.claims', '{"sub":"a8000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select * from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'), 'No lines',
  p_discount => '{"type": "fixed", "value": 5}') $$, '22023', null, 'a discount needs a service');

-- ===== A revision keeps the discount ==========================================
select lives_ok($$ select public.set_estimate_discount(pg_temp.v('e2'), 'percent', 10) $$, 'owner discounts e2');
select lives_ok($$ select public.set_estimate_status(pg_temp.v('e2'), 'sent') $$, 'send e2');
select throws_ok($$ select public.set_estimate_discount(pg_temp.v('e2'), 'percent', 20) $$, '22023', null,
  'a sent estimate cannot be changed');
insert into t values ('e3', public.revise_estimate(pg_temp.v('e2'))::text);
reset role;
select is((pg_temp.est(pg_temp.v('e3'))).discount_value, 10.00::numeric(12, 2), 'the revision keeps the discount');
select is((pg_temp.est(pg_temp.v('e3'))).total_cents, 3969::bigint, 'and its totals');
set local role authenticated;
select lives_ok($$ select public.set_estimate_discount(pg_temp.v('e3'), null, null) $$, 'remove it');
reset role;
-- No discount: GST 4000 → 200, PST 3000 → 210.
select is((pg_temp.est(pg_temp.v('e3'))).total_cents, 4410::bigint, 'totals without a discount');

select * from finish();
rollback;
