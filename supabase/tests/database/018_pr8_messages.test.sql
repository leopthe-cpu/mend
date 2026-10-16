-- PR 8: three message templates + automatic "ticket created" message.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('h1000000-0000-0000-0000-000000000001', 'owner@h.test', now(), '{}'),
  ('h1000000-0000-0000-0000-000000000002', 'staff@h.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated;

-- ===== Renderer parity with the same fixture used in src/lib/messages.test.ts =
select is(
  private.render_message_template(
    'Hi {customer_first_name}, thanks for visiting {shop_name}. Your order {ticket_title} (#{ticket_number}) will be ready on {promised_date}. {payment_line}',
    '{"customer_first_name":"Maria","customer_name":"Maria Rossi","shop_name":"Tailor and Cleaners","ticket_title":"winter coat","item_name":"winter coat","ticket_number":1042,"promised_date":"Tue, Oct 20","shop_hours":"Mon-Sat 9-6","pickup_hours":"Mon-Sat 9-6","amount_due":"$100.00","payment_line":"Payment of $100.00 is due at pick-up."}'::jsonb
  ),
  'Hi Maria, thanks for visiting Tailor and Cleaners. Your order winter coat (#1042) will be ready on Tue, Oct 20. Payment of $100.00 is due at pick-up.',
  'the SQL renderer matches the TS renderer on the same fixture'
);
select is(private.money_text(10000, 'CAD'), '$100.00', 'money_text formats cents');
select is(private.render_message_template('Ready {shop_hours}', '{"shop_hours":""}'::jsonb), 'Ready', 'an empty variable leaves no dangling space');

-- ===== Shop, customer, catalog ============================================
select set_config('request.jwt.claims', '{"sub":"h1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('H Repairs', null, 'other', 'CA', null, 'America/Toronto',
  null, null, null, '{}', '[{"name":"HST","rate":13}]')::text);
insert into t values ('maria', public.save_customer(pg_temp.v('shop'), null, 'Maria Rossi', '4165550100', 'maria@example.com')::text);
with x as (insert into public.catalog_items (shop_id, name, item_type, unit, price_cents)
  values (pg_temp.v('shop'), 'Resole', 'service', 'each', 15000) returning id)
insert into t select 'resole', id::text from x;
reset role;
insert into public.memberships (shop_id, user_id, role) values
  (pg_temp.v('shop'), 'h1000000-0000-0000-0000-000000000002', 'staff');

-- Existing shops are seeded with created + reminder (one per channel).
select is((select count(*)::int from public.message_templates where shop_id = pg_temp.v('shop') and kind = 'created'), 2,
  'the migration seeds one created template per channel');
select is((select count(*)::int from public.message_templates where shop_id = pg_temp.v('shop') and kind = 'reminder'), 2,
  'and one reminder template per channel');

-- ===== queue_message accepts 'created', rejects unknown kinds ==============
select set_config('request.jwt.claims', '{"sub":"h1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
insert into t select 'tk', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('maria'), 'Coat');
insert into t select 'm1', message_id::text from public.queue_message(pg_temp.v('tk'), 'sms', 'Hi Maria', null, 'created');
select is((select kind::text from public.messages where id = pg_temp.v('m1')), 'created', 'queue_message accepts the created kind');
select throws_ok($$ select public.queue_message(pg_temp.v('tk'), 'sms', 'Hi', null, 'bogus') $$, '22023', null, 'an unknown kind is rejected');

-- Staff cannot edit templates.
select throws_ok($$ insert into public.message_templates (shop_id, kind, channel, body) values (pg_temp.v('shop'), 'created', 'sms', 'x') $$,
  '42501', null, 'staff cannot insert templates');
select throws_ok($$ update public.message_templates set body = 'x' where shop_id = pg_temp.v('shop') and kind = 'created' and channel = 'sms' $$,
  '42501', null, 'staff cannot update templates');
reset role;

-- ===== Consent + automatic created message with a deposit ===================
select set_config('request.jwt.claims', '{"sub":"h1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t select 'dep', ticket_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('maria'),
  'Resole boots', null, null, null, '{}', null, false,
  ('[{"catalog_item_id":"' || pg_temp.v('resole') || '","quantity":1}]')::jsonb,
  '{"amount_cents":5000}', true);
select is((select updates_consent from public.tickets where id = pg_temp.v('dep')), true, 'consent is stored');
select ok((select updates_consent_at is not null and updates_consent_by = 'h1000000-0000-0000-0000-000000000001'
             from public.tickets where id = pg_temp.v('dep')), 'consent timestamp and actor are stored');
select ok(exists (select 1 from public.messages where ticket_id = pg_temp.v('dep') and kind = 'created'),
  'the created message is queued automatically');
select ok(exists (select 1 from public.messages where ticket_id = pg_temp.v('dep') and kind = 'created' and body like '%$100.00%'),
  'a $50 deposit on a $150 ticket leaves $100.00 due');
reset role;

-- ===== Opted-out customer gets nothing, and the ticket is still created =====
select set_config('request.jwt.claims', '{"sub":"h1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.set_customer_opt_out(pg_temp.v('maria'), 'sms', true);
select public.set_customer_opt_out(pg_temp.v('maria'), 'email', true);
insert into t select 'opt', ticket_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('maria'),
  'Plain', null, null, null, '{}', null, false, '[]', null, true);
select ok(exists (select 1 from public.tickets where id = pg_temp.v('opt')), 'the ticket is created even when messaging fails');
select is((select count(*)::int from public.messages where ticket_id = pg_temp.v('opt')), 0, 'an opted-out customer gets no message');
select ok(exists (select 1 from public.audit_log where action = 'message.created_skipped' and entity_id = pg_temp.v('opt')),
  'the skip is audited');
reset role;

-- ===== Trade change seeds created + reminder exactly once per channel =====
select set_config('request.jwt.claims', '{"sub":"h1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.create_shop('I Repairs', null, 'other', 'CA', null, 'America/Toronto');
select id into t from public.shops where name = 'I Repairs';
insert into t values ('shop_i', (select v from t where k = 'shop_i')) on conflict (k) do nothing;
reset role;

select is((select count(*)::int from public.message_templates where shop_id = (select v::uuid from t where k = 'shop_i') and kind = 'created'), 2,
  'new shops get created templates');
select is((select count(*)::int from public.message_templates where shop_id = (select v::uuid from t where k = 'shop_i') and kind = 'reminder'), 2,
  'new shops get reminder templates');

select * from finish();
rollback;
