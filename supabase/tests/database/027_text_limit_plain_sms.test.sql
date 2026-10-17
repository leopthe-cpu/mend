-- Decision 84: 100 texts a month by default; texts use plain punctuation.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('ac000000-0000-0000-0000-000000000001', 'owner@plain.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated;

select set_config('request.jwt.claims', '{"sub":"ac000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('Plain Shop', null, 'other', 'CA', null, 'America/Toronto')::text);
insert into t values ('cust', public.save_customer(pg_temp.v('shop'), null, 'Zoë Tran', '4165550600', 'zoe@example.com')::text);
insert into t select 'tk', ticket_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'), 'Coat');
reset role;
update public.shops set address = '1 Main St, Toronto ON', phone = '416 555 0000' where id = pg_temp.v('shop');

select is((select sms_monthly_cap from public.shops where id = pg_temp.v('shop')), 100, 'new shops get 100 texts a month');

set local role authenticated;
insert into t select 'm1', message_id::text from public.queue_message(pg_temp.v('tk'), 'sms',
  E'It’s ready – open 9am–5pm… “thanks”, Zoë');
insert into t select 'm2', message_id::text from public.queue_message(pg_temp.v('tk'), 'email',
  E'Open 9am–5pm', 'Ready');
reset role;
select ok((select body like E'It''s ready - open 9am-5pm... "thanks", Zoë%' from public.messages where id = pg_temp.v('m1')),
  'texts get plain dashes, quotes and ellipses; accents stay');
select ok((select body like E'%9am–5pm%' from public.messages where id = pg_temp.v('m2')), 'emails keep the original characters');

select * from finish();
rollback;
