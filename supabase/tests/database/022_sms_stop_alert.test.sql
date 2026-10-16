-- Decision 77: a STOP (or staff opt-out) is stamped and shows on open tickets.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('bc000000-0000-0000-0000-000000000001', 'owner@stopalert.test', now(), '{}'),
  ('bc000000-0000-0000-0000-000000000002', 'owner2@stopalert.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated, service_role;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated, service_role;
create function pg_temp.events(p uuid) returns int language sql as $$
  select count(*)::int from public.ticket_events where ticket_id = p and type = 'message' and data ->> 'action' = 'sms_opt_out' $$;

select set_config('request.jwt.claims', '{"sub":"bc000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('Alert Repairs', null, 'other', 'CA', null, 'America/Toronto')::text);
insert into t values ('ana', public.save_customer(pg_temp.v('shop'), null, 'Ana Silva', '4165550101', 'ana@example.com')::text);
insert into t values ('ben', public.save_customer(pg_temp.v('shop'), null, 'Ben Cho', '4165550102')::text);
insert into t select 'open', ticket_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('ana'),
  'Zip', null, null, null, '{}', null, false, '[]', null, false);
insert into t select 'done', ticket_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('ana'),
  'Hem', null, null, null, '{}', null, false, '[]', null, false);
insert into t select 'bens', ticket_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('ben'),
  'Coat', null, null, null, '{}', null, false, '[]', null, false);
reset role;
update public.tickets set picked_up_at = now() where id = pg_temp.v('done');
-- Another shop with the same customer phone: a STOP reaches both.
select set_config('request.jwt.claims', '{"sub":"bc000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop2', public.create_shop('Other Repairs', null, 'other', 'CA', null, 'America/Toronto')::text);
insert into t values ('ana2', public.save_customer(pg_temp.v('shop2'), null, 'Ana S', '416-555-0101')::text);
insert into t select 'open2', ticket_id::text from public.create_ticket_full(pg_temp.v('shop2'), pg_temp.v('ana2'),
  'Watch', null, null, null, '{}', null, false, '[]', null, false);
reset role;

-- Inbound STOP from the Twilio webhook (service role, no signed-in user).
select set_config('request.jwt.claims', '{}', true);
set local role service_role;
select is(public.record_sms_opt_out('+14165550101', true), 2, 'STOP opts out the phone at both shops');
reset role;
select ok((select sms_opted_out and sms_opt_out_source = 'stop' and sms_opted_out_at is not null
             from public.customers where id = pg_temp.v('ana')), 'stamped as a STOP with the time');
select is(pg_temp.events(pg_temp.v('open')), 1, 'the open ticket gets a timeline entry');
select is(pg_temp.events(pg_temp.v('done')), 0, 'a picked-up ticket does not');
select is(pg_temp.events(pg_temp.v('open2')), 1, 'the other shop is told too');
select is((select actor_id from public.ticket_events where ticket_id = pg_temp.v('open') and data ->> 'action' = 'sms_opt_out'),
  null, 'no actor for a customer STOP');

-- A repeated STOP adds nothing.
set local role service_role;
select is(public.record_sms_opt_out('+14165550101', true), 0, 'a second STOP changes nothing');
reset role;
select is(pg_temp.events(pg_temp.v('open')), 1, 'and adds no entry');

-- Staff turning texts off is stamped as staff; turning them back on clears it.
select set_config('request.jwt.claims', '{"sub":"bc000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.set_customer_opt_out(pg_temp.v('ben'), 'sms', true);
select is((select sms_opt_out_source from public.customers where id = pg_temp.v('ben')), 'staff', 'staff opt-out is stamped as staff');
select is((select count(*)::int from public.ticket_events where ticket_id = pg_temp.v('bens') and data ->> 'source' = 'staff'), 1,
  'with a timeline entry');
select public.set_customer_opt_out(pg_temp.v('ana'), 'sms', false);
select ok((select not sms_opted_out and sms_opted_out_at is null and sms_opt_out_source is null
             from public.customers where id = pg_temp.v('ana')), 'turning texts back on clears the stamp');
select lives_ok($$ select sms_opted_out_at, sms_opt_out_source from public.customers $$, 'members can read the stamp');
reset role;

select * from finish();
rollback;
