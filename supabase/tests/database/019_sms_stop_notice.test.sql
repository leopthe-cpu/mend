-- Launch plan L1c: the first text to a customer from a shop says how to opt out.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('b9000000-0000-0000-0000-000000000001', 'owner@stop.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated;
-- Each test runs in one transaction, so now() doesn't move: move earlier
-- messages back past the 2-minute gap between messages (decision 137).
create function pg_temp.age_messages() returns void language sql security definer as $$
  update public.messages set created_at = created_at - interval '3 minutes', after_cooldown = false,
    scheduled_for = case when queued_for_quiet_hours then scheduled_for
                         else least(scheduled_for, now()) - interval '3 minutes' end $$;
grant execute on function pg_temp.age_messages() to authenticated;
create function pg_temp.body(p uuid) returns text language sql as $$ select body from public.messages where id = p $$;

select set_config('request.jwt.claims', '{"sub":"b9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('Stop Repairs', null, 'other', 'CA', null, 'America/Toronto')::text);
-- Emails need the shop's email address (decision 143).
update public.shops set email = 'shop@example.com' where id = pg_temp.v('shop');
insert into t values ('ana', public.save_customer(pg_temp.v('shop'), null, 'Ana Silva', '4165550101', 'ana@example.com')::text);
insert into t values ('ben', public.save_customer(pg_temp.v('shop'), null, 'Ben Cho', '4165550102', 'ben@example.com')::text);
insert into t select 'ta', ticket_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('ana'),
  'Zip repair', null, null, null, '{}', null, false, '[]', null, false);
insert into t select 'tb', ticket_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('ben'),
  'Hem', null, null, null, '{}', null, false, '[]', null, false);
reset role;
-- Texts need the shop's address and phone (decision 76).
update public.shops set address = '1 Main St, Toronto ON', phone = '416 555 0000';
create function pg_temp.notice() returns text language sql as $$
  select 'Reply STOP to opt out. Shop info: https://www.mendshops.com/s/' || public_code
    from public.shops where id = pg_temp.v('shop') $$;
set local role authenticated;

-- First text to Ana gets the notice; the second doesn't.
insert into t select 'a1', message_id::text from public.queue_message(pg_temp.v('ta'), 'sms', 'Your zip is ready.');
select pg_temp.age_messages();
insert into t select 'a2', message_id::text from public.queue_message(pg_temp.v('ta'), 'sms', 'Reminder: your zip is ready.');
-- Email never gets it.
select pg_temp.age_messages();
insert into t select 'ae', message_id::text from public.queue_message(pg_temp.v('ta'), 'email', 'Your zip is ready.', 'Ready');
reset role;

select is(pg_temp.body(pg_temp.v('a1')), 'Your zip is ready. ' || pg_temp.notice(), 'first text gets the opt-out notice');
select is(pg_temp.body(pg_temp.v('a2')), 'Reminder: your zip is ready.', 'later texts do not repeat it');
select is(pg_temp.body(pg_temp.v('ae')), 'Your zip is ready.', 'emails are unchanged');

-- A canceled first text doesn't count: the next text carries the notice.
update public.messages set status = 'canceled' where customer_id = pg_temp.v('ben');
set local role authenticated;
insert into t select 'b1', message_id::text from public.queue_message(pg_temp.v('tb'), 'sms', 'Your hem is started.');
reset role;
update public.messages set status = 'canceled' where id = pg_temp.v('b1');
set local role authenticated;
select pg_temp.age_messages();
insert into t select 'b2', message_id::text from public.queue_message(pg_temp.v('tb'), 'sms', 'Your hem is ready.');
reset role;
select is(pg_temp.body(pg_temp.v('b2')), 'Your hem is ready. ' || pg_temp.notice(), 'a canceled text does not count as the first');

-- A text that already mentions STOP is left alone and counts as the first.
delete from public.messages where customer_id = pg_temp.v('ben');
set local role authenticated;
select pg_temp.age_messages();
insert into t select 'b3', message_id::text from public.queue_message(pg_temp.v('tb'), 'sms', 'Ready! Text STOP to unsubscribe.');
select pg_temp.age_messages();
insert into t select 'b4', message_id::text from public.queue_message(pg_temp.v('tb'), 'sms', 'See you soon.');
reset role;
select is(pg_temp.body(pg_temp.v('b3')), 'Ready! Text STOP to unsubscribe.', 'a body mentioning STOP is unchanged');
select is(pg_temp.body(pg_temp.v('b4')), 'See you soon.', 'and the next text needs no notice');

-- A body too long for the notice is sent as is; the next text carries it.
delete from public.messages where customer_id = pg_temp.v('ben');
set local role authenticated;
select pg_temp.age_messages();
insert into t select 'b5', message_id::text from public.queue_message(pg_temp.v('tb'), 'sms', repeat('a', 1590));
select pg_temp.age_messages();
insert into t select 'b6', message_id::text from public.queue_message(pg_temp.v('tb'), 'sms', 'Short one.');
reset role;
select is(char_length(pg_temp.body(pg_temp.v('b5'))), 1590, 'a body with no room keeps its length');
select is(pg_temp.body(pg_temp.v('b6')), 'Short one. ' || pg_temp.notice(), 'the next text carries the notice');

-- Notices are per shop and per customer: Ana already had hers.
select is((select count(*)::int from public.messages where customer_id = pg_temp.v('ana') and body ~* '\mstop\M'), 1,
  'exactly one notice for Ana');

select * from finish();
rollback;
