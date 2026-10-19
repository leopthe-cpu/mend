-- One conversation per messaged customer, latest message first (decision 104).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('af000000-0000-0000-0000-000000000001', 'owner@threads.test', now(), '{}'),
  ('af000000-0000-0000-0000-000000000002', 'other@threads.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated;

select set_config('request.jwt.claims', '{"sub":"af000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('Threads Shop', null, 'other', 'CA', null, 'America/Toronto')::text);
insert into t values ('ann', public.save_customer(pg_temp.v('shop'), null, 'Ann Lee', null, 'ann@example.com', 'email')::text);
insert into t values ('bob', public.save_customer(pg_temp.v('shop'), null, 'Bob Roy', null, 'bob@example.com', 'email')::text);
insert into t select 'tk_ann', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('ann'), 'Coat');
insert into t select 'tk_bob', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('bob'), 'Jeans');
reset role;
-- Messages written directly (as the dispatcher would), with fixed times.
insert into public.messages (shop_id, ticket_id, customer_id, channel, subject, body, created_at) values
  (pg_temp.v('shop'), pg_temp.v('tk_ann'), pg_temp.v('ann'), 'email', 'Hi', 'First to Ann', now() - interval '2 hours'),
  (pg_temp.v('shop'), pg_temp.v('tk_ann'), pg_temp.v('ann'), 'email', 'Ready', 'Latest to Ann', now() - interval '1 hour'),
  (pg_temp.v('shop'), pg_temp.v('tk_bob'), pg_temp.v('bob'), 'email', 'Hi', 'Only to Bob', now() - interval '3 hours');

set local role authenticated;
select results_eq(
  $$ select customer_name, last_body from public.message_threads order by last_at desc $$,
  $$ values ('Ann Lee'::text, 'Latest to Ann'::text), ('Bob Roy'::text, 'Only to Bob'::text) $$,
  'one row per customer with their latest message');
reset role;

select set_config('request.jwt.claims', '{"sub":"af000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is_empty($$ select * from public.message_threads $$, 'other shops see no conversations');
reset role;

set local role anon;
select throws_ok($$ select * from public.message_threads $$, '42501', null, 'anon cannot read conversations');
reset role;

select * from finish();
rollback;
