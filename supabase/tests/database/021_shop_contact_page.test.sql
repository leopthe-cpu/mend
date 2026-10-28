-- Decision 76: public shop contact page, address + phone required for texts,
-- and the contact link in the opt-out notice.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('bb000000-0000-0000-0000-000000000001', 'owner@contact.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated, anon;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated, anon;
-- Each test runs in one transaction, so now() doesn't move: move earlier
-- messages back past the 2-minute gap between messages (decision 137).
create function pg_temp.age_messages() returns void language sql security definer as $$
  update public.messages set created_at = created_at - interval '3 minutes', after_cooldown = false,
    scheduled_for = case when queued_for_quiet_hours then scheduled_for
                         else least(scheduled_for, now()) - interval '3 minutes' end $$;
grant execute on function pg_temp.age_messages() to authenticated;

select set_config('request.jwt.claims', '{"sub":"bb000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('Contact Repairs', null, 'other', 'CA', null, 'America/Toronto')::text);
insert into t values ('ana', public.save_customer(pg_temp.v('shop'), null, 'Ana Silva', '4165550101', 'ana@example.com')::text);
insert into t select 'tk', ticket_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('ana'),
  'Zip repair', null, null, null, '{}', null, false, '[]', null, false);

select ok((select public_code ~ '^[0-9a-f]{10}$' from public.shops where id = pg_temp.v('shop')), 'a new shop gets a public code');
select throws_ok($$ update public.shops set public_code = 'aaaaaaaaaa' where id = pg_temp.v('shop') $$,
  '42501', null, 'the code is not client-writable');

-- No address or phone yet: texts are refused. No shop email: emails are
-- refused too (decision 143); with one, emails work without address/phone.
select throws_ok($$ select public.queue_message(pg_temp.v('tk'), 'sms', 'Ready.') $$, '22023',
  'add your shop''s address and phone in Settings → Shop before texting customers', 'no address/phone: texts refused');
select throws_ok($$ select public.queue_message(pg_temp.v('tk'), 'email', 'Ready.', 'Ready') $$, '22023',
  'add your shop''s email in Settings → Shop before emailing customers', 'no shop email: emails refused');
update public.shops set email = 'shop@example.com' where id = pg_temp.v('shop');
select lives_ok($$ select public.queue_message(pg_temp.v('tk'), 'email', 'Ready.', 'Ready') $$, 'emails allowed once the shop has an email');
update public.shops set address = '1 Main St, Toronto ON' where id = pg_temp.v('shop');
select pg_temp.age_messages();
select throws_ok($$ select public.queue_message(pg_temp.v('tk'), 'sms', 'Ready.') $$, '22023', null, 'address alone is not enough');
update public.shops set phone = '416 555 0000' where id = pg_temp.v('shop');

select pg_temp.age_messages();
insert into t select 'm1', message_id::text from public.queue_message(pg_temp.v('tk'), 'sms', 'Ready.');
reset role;
select is((select body from public.messages where id = pg_temp.v('m1')),
  'Ready. Reply STOP to opt out. Shop info: https://www.mendshops.com/s/'
    || (select public_code from public.shops where id = pg_temp.v('shop')),
  'the first text links the contact page');

-- The automatic "created" message is skipped (and audited) while details are missing.
update public.shops set phone = null where id = pg_temp.v('shop');
set local role authenticated;
insert into t select 'tk2', ticket_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('ana'),
  'Hem', null, null, null, '{}', null, false, '[]', null, true);
reset role;
select ok(exists (select 1 from public.tickets where id = pg_temp.v('tk2')), 'the ticket is still created');
select ok(exists (select 1 from public.audit_log where action = 'message.created_skipped' and entity_id = pg_temp.v('tk2')),
  'the skipped automatic text is audited');
-- Same for the automatic email when the shop has no email (decision 143).
update public.shops set email = null where id = pg_temp.v('shop');
set local role authenticated;
insert into t values ('bo', public.save_customer(pg_temp.v('shop'), null, 'Bo Email', null, 'bo@example.com')::text);
insert into t select 'tk3', ticket_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('bo'),
  'Coat', null, null, null, '{}', null, false, '[]', null, true);
reset role;
select ok(exists (select 1 from public.audit_log where action = 'message.created_skipped' and entity_id = pg_temp.v('tk3')),
  'the skipped automatic email is audited');
select ok(not exists (select 1 from public.messages where ticket_id = pg_temp.v('tk3')), 'and nothing was queued');
update public.shops set phone = '416 555 0000', email = 'hi@contact.test',
  business_hours = '{"text":"Mon-Fri 9-5"}' where id = pg_temp.v('shop');

-- Anyone can read the contact details by code, and only those fields.
insert into t select 'code', public_code from public.shops where id = pg_temp.v('shop');
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select results_eq($$ select name, address, phone, email, hours from public.shop_contact((select v from t where k = 'code')) $$,
  $$ values ('Contact Repairs'::text, '1 Main St, Toronto ON'::text, '416 555 0000'::text, 'hi@contact.test'::text, 'Mon-Fri 9-5'::text) $$,
  'anon reads the contact details by code');
select is_empty($$ select * from public.shop_contact('0000000000') $$, 'an unknown code returns nothing');
select throws_ok($$ select count(*) from public.shops $$, '42501', null, 'anon still cannot read shops');
reset role;

select * from finish();
rollback;
