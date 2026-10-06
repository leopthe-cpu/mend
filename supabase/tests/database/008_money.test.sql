-- Phase 3 acceptance (docs/spec.md §9 Phase 3, decisions P1, P2): the
-- $426.01 example, per-rate tax rounding, role rules on line items, frozen
-- snapshots, the Nov 30 time-zone case, versioning, invoices, payments, audit.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('d1000000-0000-0000-0000-000000000001', 'owner@d.test', now(), '{}'),
  ('d1000000-0000-0000-0000-000000000002', 'admin@d.test', now(), '{}'),
  ('d1000000-0000-0000-0000-000000000003', 'staff@d.test', now(), '{}'),
  ('e1000000-0000-0000-0000-000000000001', 'owner@e.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated;

-- Shop D with 13% HST; shop E elsewhere.
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('D Repairs', null, 'other', 'CA', null, 'America/Toronto',
  null, null, null, '{}', '[{"name":"HST","rate":13}]')::text);
insert into t select 'hst', id::text from public.tax_rates where shop_id = pg_temp.v('shop');
-- Owner builds the catalog (spec example).
with x as (insert into public.catalog_items (shop_id, name, item_type, unit, price_cents, discount_type, discount_value)
  values (pg_temp.v('shop'), 'Screen replacement', 'part', 'each', 18000, 'percent', 10) returning id)
insert into t select 'screen', id::text from x;
with x as (insert into public.catalog_items (shop_id, name, item_type, unit, price_cents)
  values (pg_temp.v('shop'), 'Battery', 'part', 'each', 9000) returning id)
insert into t select 'battery', id::text from x;
with x as (insert into public.catalog_items (shop_id, name, item_type, unit, price_cents, discount_type, discount_value)
  values (pg_temp.v('shop'), 'Labor', 'labor', 'hour', 6000, 'fixed', 20) returning id)
insert into t select 'labor', id::text from x;
with x as (insert into public.catalog_items (shop_id, name, item_type, unit, price_cents)
  values (pg_temp.v('shop'), 'Screen protector', 'part', 'each', 2500) returning id)
insert into t select 'protector', id::text from x;
with x as (insert into public.catalog_items (shop_id, name, item_type, unit, price_cents)
  values (pg_temp.v('shop'), 'Sticker', 'part', 'each', 10) returning id)
insert into t select 'sticker', id::text from x;
insert into public.catalog_item_tax_rates (shop_id, catalog_item_id, tax_rate_id)
  select pg_temp.v('shop'), v::uuid, pg_temp.v('hst') from t where k in ('screen', 'battery', 'labor', 'protector', 'sticker');
insert into public.catalog_item_costs (shop_id, catalog_item_id, cost_cents) values (pg_temp.v('shop'), pg_temp.v('screen'), 7000);
insert into t values ('cust', public.save_customer(pg_temp.v('shop'), null, 'Maria', '4165550100')::text);
insert into t select 'tk', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('cust'), 'iPhone 13');
reset role;
insert into public.memberships (shop_id, user_id, role) values
  (pg_temp.v('shop'), 'd1000000-0000-0000-0000-000000000002', 'admin'),
  (pg_temp.v('shop'), 'd1000000-0000-0000-0000-000000000003', 'staff');
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop_e', public.create_shop('E Repairs', null, 'other', 'CA', null, 'America/Toronto')::text);
reset role;

-- ===== Pure helpers ====================================================
select is(private.shop_local_date('2026-12-01 03:00+00', 'America/Toronto'), '2026-11-30'::date,
  '03:00 UTC on Dec 1 is still Nov 30 in Toronto');
select ok(private.discount_active_on(null, '2026-11-30', private.shop_local_date('2026-12-01 03:00+00', 'America/Toronto')),
  'a discount ending Nov 30 applies to a line added late on Nov 30 shop time');
select ok(not private.discount_active_on(null, '2026-11-30', private.shop_local_date('2026-12-01 06:00+00', 'America/Toronto')),
  'and not to one added on Dec 1 shop time');
select ok(not private.discount_active_on('2026-12-01', null, '2026-11-30'), 'a discount starting Dec 1 is not active on Nov 30');
select results_eq($$ select subtotal_cents, discount_cents, total_cents from private.line_math(2, 6000, 'fixed', 20, false) $$,
  $$ values (12000::bigint, 2000::bigint, 10000::bigint) $$, 'a fixed discount comes off the whole line, not per unit');
select results_eq($$ select subtotal_cents, discount_cents, total_cents from private.line_math(1.5, 3333, 'percent', 10, false) $$,
  $$ values (5000::bigint, 500::bigint, 4500::bigint) $$, '1.5 x $33.33 = $49.995 rounds half away from zero to $50.00');
select throws_ok($$ select * from private.line_math(1, 1000, 'fixed', 20, false) $$, '22023', null,
  'a manual fixed discount above the line is rejected');
select results_eq($$ select discount_cents from private.line_math(1, 1000, 'fixed', 20, true) $$,
  $$ values (1000::bigint) $$, 'a catalog fixed discount above a small line is capped at the line');

-- ===== The spec example, built by Staff ===============================
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('est', public.start_estimate(pg_temp.v('tk'))::text);
insert into t values ('l_screen', public.add_estimate_line(pg_temp.v('est'), pg_temp.v('screen'))::text);
insert into t values ('l_battery', public.add_estimate_line(pg_temp.v('est'), pg_temp.v('battery'))::text);
insert into t values ('l_labor', public.add_estimate_line(pg_temp.v('est'), pg_temp.v('labor'), 2)::text);
insert into t values ('l_protector', public.add_estimate_line(pg_temp.v('est'), pg_temp.v('protector'))::text);
select results_eq($$ select name_snapshot, line_subtotal_cents, discount_cents, line_total_cents, discount_source::text
                      from public.estimate_line_items where estimate_id = pg_temp.v('est') order by position $$,
  $$ values ('Screen replacement'::text, 18000::bigint, 1800::bigint, 16200::bigint, 'catalog'::text),
            ('Battery', 9000, 0, 9000, null),
            ('Labor', 12000, 2000, 10000, 'catalog'),
            ('Screen protector', 2500, 0, 2500, null) $$,
  'lines: $162.00, $90.00, $100.00, $25.00 with catalog discounts copied');
select results_eq($$ select subtotal_before_cents, savings_cents, subtotal_cents, tax_cents, total_cents
                      from public.estimates where id = pg_temp.v('est') $$,
  $$ values (41500::bigint, 3800::bigint, 37700::bigint, 4901::bigint, 42601::bigint) $$,
  'subtotal $415.00, savings $38.00, after discounts $377.00, HST $49.01, total $426.01');
select is((select tax_breakdown -> 0 ->> 'name' from public.estimates where id = pg_temp.v('est')), 'HST', 'tax listed per rate');

-- Staff limits (spec §5 matrix).
select throws_ok($$ select public.add_estimate_line(pg_temp.v('est'), pg_temp.v('battery'), 1, 5000) $$, '42501', null,
  'staff cannot add a line with a custom price');
select throws_ok($$ select public.add_custom_line(pg_temp.v('est'), 'Cleaning', 1, 1000) $$, '42501', null,
  'staff cannot add a custom line');
select throws_ok($$ select public.set_line_discount(pg_temp.v('l_battery'), 'percent', 5, 'loyal') $$, '42501', null,
  'staff cannot add a discount');
select throws_ok($$ select public.set_line_discount(pg_temp.v('l_screen'), null, null) $$, '42501', null,
  'staff cannot remove a catalog discount');
select throws_ok($$ select public.update_estimate_line(pg_temp.v('l_battery'), null, 8000) $$, '42501', null,
  'staff cannot change a price');
select lives_ok($$ select public.update_estimate_line(pg_temp.v('l_protector'), 2) $$, 'staff can change a quantity');
select lives_ok($$ select public.update_estimate_line(pg_temp.v('l_protector'), 1) $$, 'and change it back');
select throws_ok($$ insert into public.estimate_line_items (shop_id, estimate_id, position, name_snapshot, unit_price_cents,
  quantity, line_subtotal_cents, line_total_cents, added_on) values (pg_temp.v('shop'), pg_temp.v('est'), 9, 'Free', 0, 1, 0, 0, current_date) $$,
  '42501', null, 'clients cannot write line items directly');
select throws_ok($$ update public.estimates set total_cents = 1 where id = pg_temp.v('est') $$, '42501', null,
  'clients cannot change estimate totals directly');
select is((select count(*)::int from public.catalog_item_costs), 0, 'staff cannot see item costs');
reset role;
select is((select added_on from public.estimate_line_items where id = pg_temp.v('l_battery')),
  private.shop_local_date(now(), 'America/Toronto'), 'lines record the shop-local date they were added');

-- Admin: override, discount, custom line, all audited.
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.catalog_item_costs), 0, 'admins cannot see item costs either');
select lives_ok($$ select public.update_estimate_line(pg_temp.v('l_battery'), null, 8000) $$, 'admin overrides a price');
select results_eq($$ select catalog_unit_price_cents, unit_price_cents from public.estimate_line_items where id = pg_temp.v('l_battery') $$,
  $$ values (9000::bigint, 8000::bigint) $$, 'the catalog price snapshot is kept next to the override ("was $90, sold at $80")');
select lives_ok($$ select public.set_line_discount(pg_temp.v('l_screen'), 'fixed', 30, 'Price match') $$,
  'admin replaces the catalog discount (still one discount per line)');
select results_eq($$ select discount_type::text, discount_value, discount_source::text, discount_cents from public.estimate_line_items where id = pg_temp.v('l_screen') $$,
  $$ values ('fixed'::text, 30.00::numeric, 'manual'::text, 3000::bigint) $$, 'manual discount stored');
select throws_ok($$ select public.set_line_discount(pg_temp.v('l_screen'), 'percent', 120) $$, '22023', null, 'percent above 100 rejected');
select lives_ok($$ select public.add_custom_line(pg_temp.v('est'), 'Data recovery', 1, 5000, array[pg_temp.v('hst')]) $$, 'admin adds a custom line');
select throws_ok($$ select public.add_custom_line(pg_temp.v('est'), 'Bad', 0, 5000) $$, '22023', null, 'zero quantity rejected');
reset role;
select ok((select count(*) = 3 from public.audit_log where shop_id = pg_temp.v('shop')
            and action in ('estimate_line.price_override', 'estimate_line.discount', 'estimate_line.custom_added')),
  'override, discount and custom line are in the audit log');
select is((select new_values ->> 'reason' from public.audit_log where action = 'estimate_line.discount' and shop_id = pg_temp.v('shop')),
  'Price match', 'the discount reason is audited');

-- Catalog changes never touch existing lines; the change itself is audited.
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t select 'total_before', total_cents::text from public.estimates where id = pg_temp.v('est');
update public.catalog_items set price_cents = 99900, discount_type = null, discount_value = null where id = pg_temp.v('labor');
select results_eq($$ select unit_price_cents, discount_cents from public.estimate_line_items where id = pg_temp.v('l_labor') $$,
  $$ values (6000::bigint, 2000::bigint) $$, 'changing a catalog price or discount does not change existing lines');
select is((select total_cents::text from public.estimates where id = pg_temp.v('est')), (select v from t where k = 'total_before'),
  'and the estimate total stays the same');
select is((select count(*)::int from public.catalog_item_costs), 1, 'the owner sees item costs');
select throws_ok($$ delete from public.catalog_items where id = pg_temp.v('labor') $$, '22023', null,
  'an item used on a ticket cannot be deleted');
select lives_ok($$ delete from public.catalog_items where id = pg_temp.v('sticker') $$, 'an unused item can be deleted');
reset role;
select ok(exists (select 1 from public.audit_log where action = 'catalog_items.update'
                   and old_values ->> 'price_cents' = '6000' and new_values ->> 'price_cents' = '99900'),
  'catalog price change is audited with old and new values');

-- Per-rate tax rounding (decision P2): 3 x $0.10 at 13% is $0.04 per rate,
-- where rounding per line would give $0.03.
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
insert into t select 'tk2', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('cust'), 'iPad');
insert into t values ('est2', public.start_estimate(pg_temp.v('tk2'))::text);
select public.add_custom_line(pg_temp.v('est2'), 'Part ' || g, 1, 10, array[pg_temp.v('hst')]) from generate_series(1, 3) g;
select is((select tax_cents from public.estimates where id = pg_temp.v('est2')), 4::bigint, 'tax is rounded once per rate, not per line');
reset role;

-- ===== Status, versions, invoices ======================================
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.issue_invoice(pg_temp.v('est')) $$, '22023', null, 'a draft cannot be invoiced');
select throws_ok($$ select public.set_estimate_status(pg_temp.v('est'), 'approved') $$, '22023', null, 'approval needs a method');
select lives_ok($$ select public.set_estimate_status(pg_temp.v('est'), 'approved', 'phone') $$, 'staff records a phone approval');
select throws_ok($$ select public.add_estimate_line(pg_temp.v('est'), pg_temp.v('battery')) $$, '22023', null,
  'an approved estimate cannot be edited in place');
insert into t select 'inv1', invoice_number::text from public.issue_invoice(pg_temp.v('est'));
select is((select v from t where k = 'inv1'), '1001', 'invoice numbers start at 1001 per shop');
select is((select total_cents from public.invoices where invoice_number = 1001), (select total_cents from public.estimates where id = pg_temp.v('est')),
  'the invoice freezes the estimate total');
insert into t values ('est_v2', public.revise_estimate(pg_temp.v('est'))::text);
select results_eq($$ select version, status::text, approval_method::text from public.estimates where ticket_id = pg_temp.v('tk') order by version $$,
  $$ values (1, 'superseded'::text, 'phone'::text), (2, 'draft', null) $$, 'revising keeps v1 (with its approval) and opens v2');
select is((select total_cents from public.estimates where id = pg_temp.v('est_v2')), (select total_cents from public.estimates where id = pg_temp.v('est')),
  'v2 starts with the same lines and totals');
select lives_ok($$ select public.add_estimate_line(pg_temp.v('est_v2'), pg_temp.v('protector')) $$, 'v2 is editable');
select lives_ok($$ select public.set_estimate_status(pg_temp.v('est_v2'), 'approved', 'in_person') $$, 'v2 approved');
select results_eq($$ select invoice_number from public.issue_invoice(pg_temp.v('est_v2')) $$, $$ values (1002) $$, 'next invoice is 1002');
select results_eq($$ select invoice_number, voided_at is not null from public.invoices where ticket_id = pg_temp.v('tk') order by 1 $$,
  $$ values (1001, true), (1002, false) $$, 'the earlier invoice is voided');

-- ===== Payments ========================================================
insert into t values ('pay', public.record_payment(pg_temp.v('tk'), 'deposit', 'card', 5000, null, 'deposit at drop-off')::text);
select throws_ok($$ select public.record_payment(pg_temp.v('tk'), 'payment', 'cash', 0) $$, '22023', null, 'zero payment rejected');
select throws_ok($$ select public.update_payment(pg_temp.v('pay'), 'deposit', 'card', 6000, null) $$, '42501', null, 'staff cannot edit payments');
select throws_ok($$ select public.delete_payment(pg_temp.v('pay')) $$, '42501', null, 'staff cannot delete payments');
reset role;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.update_payment(pg_temp.v('pay'), 'deposit', 'card', 6000, null, 'corrected') $$, 'admin edits a payment');
select lives_ok($$ select public.delete_payment(pg_temp.v('pay')) $$, 'admin deletes a payment');
select is((select count(*)::int from public.payments where ticket_id = pg_temp.v('tk')), 0, 'deleted payments are hidden');
reset role;
select set_eq($$ select action from public.audit_log where entity = 'payments' and shop_id = pg_temp.v('shop') $$,
  $$ values ('payment.recorded'::text), ('payment.edited'), ('payment.deleted') $$, 'every payment change is audited');
select is((select old_values ->> 'amount_cents' from public.audit_log where action = 'payment.edited'), '5000', 'with the old amount');

-- ===== Other shops =====================================================
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.estimates) + (select count(*)::int from public.estimate_line_items)
        + (select count(*)::int from public.invoices) + (select count(*)::int from public.payments), 0,
  'another shop sees no estimates, lines, invoices or payments');
select throws_ok($$ select public.add_estimate_line(pg_temp.v('est_v2'), pg_temp.v('battery')) $$, 'P0002', null,
  'another shop cannot touch the estimate');
select throws_ok($$ select public.record_payment(pg_temp.v('tk'), 'payment', 'cash', 100) $$, 'P0002', null,
  'another shop cannot record a payment');
select throws_ok($$ select public.start_estimate(pg_temp.v('tk')) $$, 'P0002', null, 'another shop cannot start an estimate');
reset role;

-- ===== save_catalog_item ===============================================
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.save_catalog_item(pg_temp.v('shop'), null, 'Case', null, 'part', 'each', 1500) $$, '42501', null,
  'admins cannot change the catalog');
reset role;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('case', public.save_catalog_item(pg_temp.v('shop'), null, ' Case ', 'Accessories', 'part', 'each', 1500,
  null, 'percent', 15, '2026-11-01', '2026-11-30', array[pg_temp.v('hst')], 600)::text);
select results_eq($$ select c.name, c.price_cents, c.discount_value, (select count(*)::int from public.catalog_item_tax_rates x where x.catalog_item_id = c.id),
                       (select cost_cents from public.catalog_item_costs k where k.catalog_item_id = c.id)
                      from public.catalog_items c where c.id = pg_temp.v('case') $$,
  $$ values ('Case'::text, 1500::bigint, 15.00::numeric, 1, 600::bigint) $$, 'owner saves item, taxes and cost together');
select lives_ok($$ select public.save_catalog_item(pg_temp.v('shop'), pg_temp.v('case'), 'Case', 'Accessories', 'part', 'each', 1800) $$,
  'owner edits the item');
select results_eq($$ select c.price_cents, c.discount_type is null, (select count(*)::int from public.catalog_item_tax_rates x where x.catalog_item_id = c.id),
                       (select count(*)::int from public.catalog_item_costs k where k.catalog_item_id = c.id)
                      from public.catalog_items c where c.id = pg_temp.v('case') $$,
  $$ values (1800::bigint, true, 0, 0) $$, 'cleared discount, taxes and cost are removed');
select throws_ok($$ select public.save_catalog_item(pg_temp.v('shop'), null, 'Bad', null, 'part', 'each', 100, null, 'percent', 10, '2026-12-01', '2026-11-01') $$,
  '22023', null, 'a discount ending before it starts is rejected');
select throws_ok($$ select public.save_catalog_item(pg_temp.v('shop_e'), null, 'X', null, 'part', 'each', 100) $$, '42501', null,
  'not in another shop');
reset role;
select is((select old_values ->> 'cost_cents' from public.audit_log
            where action = 'catalog_item_costs.delete' and old_values ->> 'catalog_item_id' = pg_temp.v('case')::text),
  '600', 'cost removal is audited with the old cost and the item');

select * from finish();
rollback;
