-- Shop days (decision 79): open/closed days, hour labels, the texts for
-- {promised_date} and {pickup_hours}, and no ready-by date on a closed day.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('a9000000-0000-0000-0000-000000000001', 'owner@days.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated;

-- Mon–Fri 9–5, Sat 10–4, Sun closed.
create function pg_temp.hours() returns jsonb language sql as $$ select '{"text": "Mon–Fri 9am–5pm, Sat 10am–4pm", "schedule": [
  {"day":"monday","open":true,"opens":"09:00","closes":"17:00"},
  {"day":"tuesday","open":true,"opens":"09:00","closes":"17:00"},
  {"day":"wednesday","open":true,"opens":"09:00","closes":"17:00"},
  {"day":"thursday","open":true,"opens":"09:00","closes":"17:00"},
  {"day":"friday","open":true,"opens":"09:00","closes":"17:00"},
  {"day":"saturday","open":true,"opens":"10:00","closes":"16:00"},
  {"day":"sunday","open":false,"opens":"09:00","closes":"17:00"}]}'::jsonb $$;

-- ===== Helpers ================================================================
select ok(private.shop_open_on(pg_temp.hours(), '2026-10-19'), 'open on Monday');
select ok(not private.shop_open_on(pg_temp.hours(), '2026-10-18'), 'closed on Sunday');
select ok(private.shop_open_on('{}'::jsonb, '2026-10-18'), 'no schedule: open every day');
select ok(private.shop_open_on(jsonb_set(pg_temp.hours(), '{schedule}',
  (select jsonb_agg(d || '{"open": false}') from jsonb_array_elements(pg_temp.hours() -> 'schedule') d)), '2026-10-18'),
  'every day closed counts as no schedule');
select is(private.hour_label('09:00'), '9am', '9am');
select is(private.hour_label('14:30'), '2:30pm', '2:30pm');
select is(private.hour_label('12:00'), '12pm', 'noon');
select is(private.hour_label('00:00'), '12am', 'midnight');
select is(private.promised_text(pg_temp.hours(), '2026-10-19'), 'Mon, Oct 19 (open 9am–5pm)', 'promised date with hours');
select is(private.promised_text(pg_temp.hours(), '2026-11-07'), 'Sat, Nov 7 (open 10am–4pm)', 'no zero padding');
select is(private.promised_text('{}'::jsonb, '2026-10-19'), 'Mon, Oct 19', 'no schedule: just the date');
select is(private.promised_text(pg_temp.hours(), null), 'a date to be confirmed', 'no date');
-- Toronto is UTC-4 in October.
select is(private.pickup_hours_text(pg_temp.hours(), 'America/Toronto', '2026-10-16 16:00Z'),
  'Open today until 5pm.', 'Friday noon');
select is(private.pickup_hours_text(pg_temp.hours(), 'America/Toronto', '2026-10-16 12:00Z'),
  'Open today 9am–5pm.', 'Friday before opening');
select is(private.pickup_hours_text(pg_temp.hours(), 'America/Toronto', '2026-10-16 22:00Z'),
  'Next open: Sat 10am–4pm.', 'Friday evening');
select is(private.pickup_hours_text(pg_temp.hours(), 'America/Toronto', '2026-10-17 21:00Z'),
  'Next open: Mon 9am–5pm.', 'Saturday after closing skips Sunday');
select is(private.pickup_hours_text('{"text": "By appointment"}'::jsonb, 'America/Toronto', now()),
  'By appointment', 'no schedule: the hours text');

-- ===== Ready-by dates =========================================================
select set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('Days Repairs', null, 'other', 'CA', null, 'America/Toronto')::text);
insert into t values ('cust', public.save_customer(pg_temp.v('shop'), null, 'Dana Lee', '4165550400')::text);
reset role;
update public.shops set business_hours = pg_temp.hours(), address = '1 Main St, Toronto ON', phone = '416 555 0000'
 where id = pg_temp.v('shop');
set local role authenticated;
select throws_ok($$ select * from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'), 'Sunday job',
  p_promised_date => '2099-10-18') $$, '22023', null, 'a closed day is refused');
insert into t select 'tk', ticket_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'),
  'Monday job', p_promised_date => '2099-10-19', p_updates_consent => true);
select throws_ok($$ update public.tickets set promised_date = '2099-10-18' where id = pg_temp.v('tk') $$,
  '22023', null, 'moving it to a closed day is refused');
reset role;
-- The shop later closes on Mondays: the ticket's other fields can still change.
update public.shops set business_hours = jsonb_set(pg_temp.hours(), '{schedule,0,open}', 'false')
 where id = pg_temp.v('shop');
set local role authenticated;
select lives_ok($$ update public.tickets set item_name = 'Monday job (renamed)' where id = pg_temp.v('tk') $$,
  'an existing date is left alone');
reset role;

-- ===== Messages ===============================================================
select ok((select body like '%will be ready on Mon, Oct 19 (open 9am-5pm).%' from public.messages
            where ticket_id = pg_temp.v('tk') and kind = 'created'), 'the created text gives that day''s hours');
select ok((select body not like '%$0.00%' from public.messages
            where ticket_id = pg_temp.v('tk') and kind = 'created'), 'no "$0.00 due" line without a price');
select is((select count(*)::int from public.message_templates
            where kind = 'reminder' and body like '%{shop_hours}'), 0, 'default reminders now use {pickup_hours}');

select * from finish();
rollback;
