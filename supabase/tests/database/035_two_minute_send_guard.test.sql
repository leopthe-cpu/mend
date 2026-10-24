-- Decision 137: two minutes between messages on one ticket.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('ad000000-0000-0000-0000-000000000001', 'owner@gap.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated;
-- now() doesn't move inside one transaction: move earlier messages back.
create function pg_temp.age_messages() returns void language sql security definer as $$
  update public.messages set created_at = created_at - interval '3 minutes' $$;
grant execute on function pg_temp.age_messages() to authenticated;

select set_config('request.jwt.claims', '{"sub":"ad000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('Gap Shop', null, 'other', 'CA', null, 'America/Toronto')::text);
insert into t values ('cust', public.save_customer(pg_temp.v('shop'), null, 'Ana Gap', '4165550700', 'ana@example.com')::text);
insert into t select 'tk', ticket_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'), 'Coat');
insert into t select 'tk2', ticket_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'), 'Hem');
reset role;
update public.shops set address = '1 Main St, Toronto ON', phone = '416 555 0000',
  quiet_hours_start = '00:00', quiet_hours_end = '00:00' where id = pg_temp.v('shop');
set local role authenticated;

insert into t select 'm1', message_id::text from public.queue_message(pg_temp.v('tk'), 'email', 'Ready.', 'Ready');
select throws_ok($$ select public.queue_message(pg_temp.v('tk'), 'sms', 'Ready again.') $$, '54000',
  'this ticket got a message less than 2 minutes ago. Wait a moment before sending another',
  'a second message within 2 minutes is refused, on either channel');
select lives_ok($$ select public.queue_message(pg_temp.v('tk2'), 'email', 'Hem ready.', 'Ready') $$,
  'another ticket is not held back');
select lives_ok($$ select public.queue_message(pg_temp.v('tk'), 'email', 'Hi', 'Hi', 'created') $$,
  'the automatic "ticket created" message is never held back');

reset role;
update public.messages set status = 'failed' where ticket_id = pg_temp.v('tk');
set local role authenticated;
select lives_ok($$ select public.queue_message(pg_temp.v('tk'), 'email', 'Retry.', 'Ready') $$,
  'a failed message can be retried right away');

reset role;
update public.messages set status = 'canceled' where ticket_id = pg_temp.v('tk');
set local role authenticated;
select lives_ok($$ select public.queue_message(pg_temp.v('tk'), 'email', 'After cancel.', 'Ready') $$,
  'a canceled message does not count');

select pg_temp.age_messages();
select lives_ok($$ select public.queue_message(pg_temp.v('tk'), 'email', 'Later.', 'Ready') $$,
  'after 2 minutes the next message goes through');
reset role;

select * from finish();
rollback;
