-- Customer list numbers (decision 105).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('b0000000-0000-0000-0000-0000000000c1', 'owner@stats.test', now(), '{}'),
  ('b0000000-0000-0000-0000-0000000000c2', 'other@stats.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated;

select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('Stats Shop', null, 'other', 'CA', null, 'America/Toronto')::text);
insert into t values ('ann', public.save_customer(pg_temp.v('shop'), null, 'Ann Lee', '416 555 0161')::text);
insert into t values ('done_status', (select id::text from public.statuses where shop_id = pg_temp.v('shop') and is_final));
insert into t select 'a1', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('ann'), 'Coat');
insert into t select 'a2', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('ann'), 'Jeans');
insert into t select 'a3', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('ann'), 'Shirt');
insert into t select 'a4', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('ann'), 'Old');
select public.set_ticket_status(pg_temp.v('a1'), pg_temp.v('done_status'));
select public.delete_ticket(pg_temp.v('a4'));

select results_eq(
  $$ select repairs_done::int, open_tickets::int from public.customer_stats where customer_id = pg_temp.v('ann') $$,
  $$ values (1, 2) $$, 'picked up and open tickets counted; deleted ones left out');
reset role;

select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
set local role authenticated;
select is_empty($$ select * from public.customer_stats $$, 'other shops see nothing');
reset role;
set local role anon;
select throws_ok($$ select * from public.customer_stats $$, '42501', null, 'anon cannot read it');
reset role;

select * from finish();
rollback;
