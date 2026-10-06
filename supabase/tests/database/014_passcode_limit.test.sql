-- Passcode reveals are capped at 30 per person per shop per hour (decision 60).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('c9000000-0000-0000-0000-000000000001', 'owner@u.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated;

select set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('U Phones', null, 'electronics', 'CA', null, 'America/Toronto')::text);
insert into t values ('cust', public.save_customer(pg_temp.v('shop'), null, 'Uma', '416 555 0133')::text);
insert into t select 'tk', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('cust'), 'Phone',
  null, null, null, null, '{}'::jsonb, '2468');
select is(public.reveal_passcode(pg_temp.v('tk')), '2468', 'a normal reveal works');
reset role;

-- 29 more reveals in the last hour (written as the function would).
insert into public.audit_log (shop_id, actor_id, action, entity, entity_id)
select pg_temp.v('shop'), 'c9000000-0000-0000-0000-000000000001', 'passcode.revealed', 'tickets', pg_temp.v('tk')
  from generate_series(1, 29);

select set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.reveal_passcode(pg_temp.v('tk')) $$, '54000', null, 'the 31st reveal within an hour is refused');
reset role;

select * from finish();
rollback;
