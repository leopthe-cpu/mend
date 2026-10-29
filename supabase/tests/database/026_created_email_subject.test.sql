-- The automatic "Ticket created" email has its subject filled in.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('ab000000-0000-0000-0000-000000000001', 'owner@subj.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated;

select set_config('request.jwt.claims', '{"sub":"ab000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('Subject Shop', null, 'other', 'CA', null, 'America/Toronto')::text);
-- Emails need the shop's email address (decision 143).
update public.shops set email = 'shop@example.com' where id = pg_temp.v('shop');
insert into t values ('cust', public.save_customer(pg_temp.v('shop'), null, 'Eve Park', null, 'eve@example.com', 'email')::text);
insert into t select 'tk', ticket_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'),
  'Blue coat zip', p_updates_consent => true);
reset role;

select is((select subject from public.messages where ticket_id = pg_temp.v('tk') and kind = 'created'),
  'Your Blue coat zip at Subject Shop', 'the subject placeholders are filled in');
select is((select channel::text from public.messages where ticket_id = pg_temp.v('tk') and kind = 'created'),
  'email', 'sent by email');

select * from finish();
rollback;
