-- Decision 138: a 20-second wait, a hold when the ticket moves, two minutes
-- between messages (scheduled, one at a time) and the repeat check.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('ad000000-0000-0000-0000-000000000001', 'owner@gap.test', now(), '{}'),
  ('ad000000-0000-0000-0000-000000000002', 'other@gap.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated, service_role;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated, service_role;
create function pg_temp.at(p text) returns timestamptz language sql security definer as $$
  select scheduled_for from public.messages where id = pg_temp.v(p) $$;
grant execute on function pg_temp.at(text) to authenticated;

select set_config('request.jwt.claims', '{"sub":"ad000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('other_shop', public.create_shop('Other Shop', null, 'other', 'CA', null, 'America/Toronto')::text);
-- Emails need the shop's email address (decision 143).
update public.shops set email = 'shop@example.com' where id = pg_temp.v('other_shop');
reset role;
select set_config('request.jwt.claims', '{"sub":"ad000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('Gap Shop', null, 'other', 'CA', null, 'America/Toronto')::text);
-- Emails need the shop's email address (decision 143).
update public.shops set email = 'shop@example.com' where id = pg_temp.v('shop');
insert into t values ('cust', public.save_customer(pg_temp.v('shop'), null, 'Ana Gap', '4165550700', 'ana@example.com')::text);
insert into t select 'tk', ticket_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'), 'Coat');
insert into t select 'tk2', ticket_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'), 'Hem');
reset role;
update public.shops set address = '1 Main St, Toronto ON', phone = '416 555 0000',
  quiet_hours_start = '00:00', quiet_hours_end = '00:00' where id = pg_temp.v('shop');
insert into t select 'ready', id::text from public.statuses
  where shop_id = pg_temp.v('shop') and category = 'ready' order by position limit 1;
insert into t select 'open', id::text from public.statuses
  where shop_id = pg_temp.v('shop') and category = 'open' and not is_final order by position limit 1;

-- ===== 20-second wait, then 2 minutes between messages ===================
set local role authenticated;
select public.set_ticket_status(pg_temp.v('tk'), pg_temp.v('ready'));
insert into t select 'm1', message_id::text from public.queue_message(pg_temp.v('tk'), 'email', 'Ready.', 'Ready');
select is(pg_temp.at('m1'), now() + interval '20 seconds', 'a message waits 20 seconds');
insert into t select 'm2', message_id::text from public.queue_message(pg_temp.v('tk'), 'sms', 'Ready, by text.');
select is(pg_temp.at('m2'), now() + interval '20 seconds' + interval '2 minutes',
  'the next one is scheduled 2 minutes after it, on either channel');
select throws_ok($$ select public.queue_message(pg_temp.v('tk'), 'email', 'Third.', 'Hi') $$, '54000',
  'a message for this ticket is already scheduled. Wait for it to go out, or cancel it',
  'only one message waits behind another');
insert into t select 'o1', message_id::text from public.queue_message(pg_temp.v('tk2'), 'email', 'Hem ready.', 'Ready');
select is(pg_temp.at('o1'), now() + interval '20 seconds', 'another ticket is not held back');
select public.cancel_message(pg_temp.v('m2'));
select lives_ok($$ select public.queue_message(pg_temp.v('tk'), 'email', 'Instead.', 'Hi') $$,
  'canceling the scheduled one frees the slot');
reset role;
select is((select status_id from public.messages where id = pg_temp.v('m1')), pg_temp.v('ready'),
  'a status update records which status it was about');

-- Failed messages don't count toward the gap.
update public.messages set status = 'failed' where ticket_id = pg_temp.v('tk2');
set local role authenticated;
insert into t select 'o2', message_id::text from public.queue_message(pg_temp.v('tk2'), 'email', 'Retry.', 'Ready');
select is(pg_temp.at('o2'), now() + interval '20 seconds', 'after a failed message the next waits only 20 seconds');
reset role;

-- ===== Hold when the ticket moves =========================================
set local role authenticated;
select public.set_ticket_status(pg_temp.v('tk'), pg_temp.v('open'));
reset role;
select ok((select bool_and(held_at is not null) from public.messages where ticket_id = pg_temp.v('tk') and status = 'queued'),
  'moving the ticket holds its messages that have not gone out');
select ok((select held_at is null from public.messages where id = pg_temp.v('o2')), 'other tickets are not held');

update public.messages set scheduled_for = now() - interval '1 second' where status = 'queued';
set local role service_role;
create temp table c1 as select * from public.claim_due_messages(50);
reset role;
select ok(not exists (select 1 from c1 where message_id = pg_temp.v('m1')), 'a held message is not sent');
select ok(exists (select 1 from c1 where message_id = pg_temp.v('o2')), 'an unheld due message is sent');

-- Another shop can't release it; the shop's staff can.
select set_config('request.jwt.claims', '{"sub":"ad000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.release_held_message(pg_temp.v('m1')) $$, 'P0002', null,
  'another shop cannot release a held message');
reset role;
select set_config('request.jwt.claims', '{"sub":"ad000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.release_held_message(pg_temp.v('m1'));
reset role;
select ok((select held_at is null from public.messages where id = pg_temp.v('m1')), 'Send releases a held message');
set local role service_role;
create temp table c2 as select * from public.claim_due_messages(50);
reset role;
select ok(exists (select 1 from c2 where message_id = pg_temp.v('m1')), 'a released message goes out');

-- Without an answer, a held message goes out after a minute.
update public.messages set held_at = now() - interval '61 seconds' where ticket_id = pg_temp.v('tk') and status = 'queued';
set local role service_role;
create temp table c3 as select * from public.claim_due_messages(50);
reset role;
select ok((select count(*) >= 1 from c3), 'an unanswered hold expires after a minute');

-- ===== Repeat check ========================================================
update public.messages set status = 'sent', sent_at = now() - interval '10 minutes' where status in ('queued', 'sending');
set local role authenticated;
select public.set_ticket_status(pg_temp.v('tk'), pg_temp.v('ready'));
select is((select count(*)::int from public.find_repeat_message(pg_temp.v('tk'), 'status', 'email', 'Anything')), 1,
  'the same status update was already sent');
select is((select count(*)::int from public.find_repeat_message(pg_temp.v('tk'), 'manual', 'sms', 'Ready, by text.')), 0,
  'a canceled text does not count as sent');
select is((select count(*)::int from public.find_repeat_message(pg_temp.v('tk2'), 'manual', 'email', 'Retry.')), 1,
  'the same text on the same channel is a repeat');
select is((select count(*)::int from public.find_repeat_message(pg_temp.v('tk2'), 'manual', 'email', 'Something new.')), 0,
  'new text is not a repeat');
insert into t select 's1', message_id::text from public.queue_message(pg_temp.v('tk2'), 'sms', 'It’s ready – come by.');
select is((select count(*)::int from public.find_repeat_message(pg_temp.v('tk2'), 'manual', 'sms', 'It’s ready – come by.')), 1,
  'a text matches as stored (plain punctuation, STOP notice)');
reset role;
select ok((select body like 'It''s ready - come by. Reply STOP%' from public.messages where id = pg_temp.v('s1')),
  'the stored text has plain punctuation and the notice');

select ok(exists (select 1 from cron.job where jobname = 'mend-send-due-messages' and schedule = '10 seconds'),
  'the sender runs every 10 seconds');

select * from finish();
rollback;
