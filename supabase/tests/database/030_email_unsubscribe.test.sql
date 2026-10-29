-- Email unsubscribe link and one-click (decision 88).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('ae000000-0000-0000-0000-000000000001', 'owner@unsub.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated, anon;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated, anon;

select set_config('request.jwt.claims', '{"sub":"ae000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('Unsub Shop', null, 'other', 'CA', null, 'America/Toronto')::text);
-- Emails need the shop's email address (decision 143).
update public.shops set email = 'shop@example.com' where id = pg_temp.v('shop');
insert into t values ('cust', public.save_customer(pg_temp.v('shop'), null, 'Eve', null, 'eve@example.com', 'email')::text);
insert into t select 'tk', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('cust'), 'Coat');
select throws_ok($$ select unsubscribe_token from public.customers $$, '42501', null, 'members cannot read tokens');
reset role;
insert into t select 'tok', unsubscribe_token::text from public.customers where id = pg_temp.v('cust');
insert into public.messages (shop_id, ticket_id, customer_id, channel, subject, body)
  values (pg_temp.v('shop'), pg_temp.v('tk'), pg_temp.v('cust'), 'email', 'Hi', 'Queued update');
insert into t select 'msg', id::text from public.messages where customer_id = pg_temp.v('cust') limit 1;

select is((select page_url from public.email_footer_for(pg_temp.v('msg'))),
  (select value from private.app_settings where key = 'public_base_url') || '/unsubscribe?t=' || pg_temp.v('tok')::text,
  'the footer link points at the unsubscribe page');
select is((select shop_name from public.email_footer_for(pg_temp.v('msg'))), 'Unsub Shop', 'and names the shop');

set local role anon;
select is((select row(shop_name, already_stopped)::text from public.unsubscribe_preview(pg_temp.v('tok'))),
  '("Unsub Shop",f)', 'anyone with the link sees the shop');
select is((select count(*)::int from public.unsubscribe_preview(gen_random_uuid())), 0, 'an unknown token shows nothing');
select is(public.email_unsubscribe(gen_random_uuid()), false, 'an unknown token changes nothing');
select is(public.email_unsubscribe(pg_temp.v('tok')), true, 'the link stops emails');
select throws_ok($$ select * from public.email_footer_for(pg_temp.v('msg')) $$, '42501', null, 'anon cannot read footers');
reset role;

select ok((select email_opted_out from public.customers where id = pg_temp.v('cust')), 'customer is opted out of email');
select is((select status::text from public.messages where id = pg_temp.v('msg')), 'canceled', 'queued emails are canceled');
select is((select count(*)::int from public.audit_log where action = 'customer.email_unsubscribed'), 1, 'audited once');
select is(public.email_unsubscribe(pg_temp.v('tok'), 'one-click'), true, 'a second click is fine');
select is((select count(*)::int from public.audit_log where action = 'customer.email_unsubscribed'), 1, 'and not audited twice');

select * from finish();
rollback;
