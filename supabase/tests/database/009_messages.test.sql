-- Phase 4 acceptance (docs/spec.md §9 Phase 4, addendum §8): opt-outs are
-- enforced server-side, quiet hours defer sending, limits hold, only the
-- service role can claim and record, inbound STOP opts out.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('f1000000-0000-0000-0000-000000000001', 'owner@f.test', now(), '{}'),
  ('f1000000-0000-0000-0000-000000000002', 'staff@f.test', now(), '{}'),
  ('f1000000-0000-0000-0000-000000000003', 'unverified@f.test', null, '{}'),
  ('f2000000-0000-0000-0000-000000000001', 'owner@g.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated, service_role;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated, service_role;

select set_config('request.jwt.claims', '{"sub":"f1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('F Repairs', null, 'other', 'CA', null, 'America/Toronto')::text);
insert into t values ('maria', public.save_customer(pg_temp.v('shop'), null, 'Maria', '416 555 0100', 'maria@example.com')::text);
insert into t values ('noemail', public.save_customer(pg_temp.v('shop'), null, 'Pat', '416 555 0199')::text);
insert into t select 'tk', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('maria'), 'Coat');
insert into t select 'tk2', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('noemail'), 'Skis');
reset role;
insert into public.memberships (shop_id, user_id, role) values
  (pg_temp.v('shop'), 'f1000000-0000-0000-0000-000000000002', 'staff'),
  (pg_temp.v('shop'), 'f1000000-0000-0000-0000-000000000003', 'staff');
-- No quiet hours unless a test sets them.
update public.shops set quiet_hours_start = '00:00', quiet_hours_end = '00:00' where id = pg_temp.v('shop');
select set_config('request.jwt.claims', '{"sub":"f2000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop_g', public.create_shop('G Repairs', null, 'other', 'CA', null, 'America/Toronto')::text);
insert into t values ('maria_g', public.save_customer(pg_temp.v('shop_g'), null, 'Maria G', '+1 416-555-0100')::text);
reset role;

-- ===== Quiet hours (pure) ==============================================
select is(private.next_send_at('2026-10-07 02:30+00', 'America/Toronto', '21:00', '08:00'),
  '2026-10-07 12:00+00'::timestamptz, '22:30 in Toronto waits until 08:00 next morning');
select is(private.next_send_at('2026-10-07 07:00+00', 'America/Toronto', '21:00', '08:00'),
  '2026-10-07 12:00+00'::timestamptz, '03:00 in Toronto waits until 08:00 the same day');
select is(private.next_send_at('2026-10-07 16:00+00', 'America/Toronto', '21:00', '08:00'),
  '2026-10-07 16:00+00'::timestamptz, 'noon in Toronto sends now');
select is(private.next_send_at('2026-10-07 13:00+00', 'America/Vancouver', '05:00', '07:00'),
  '2026-10-07 14:00+00'::timestamptz, 'a same-day window (05:00-07:00) works too');
select is(private.next_send_at('2026-10-07 02:30+00', 'America/Toronto', '00:00', '00:00'),
  '2026-10-07 02:30+00'::timestamptz, 'equal start and end means no quiet hours');

-- ===== queue_message ===================================================
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
insert into t select 'm1', message_id::text from public.queue_message(pg_temp.v('tk'), 'sms', 'Hi Maria, your Coat is ready.');
select results_eq($$ select status::text, scheduled_for <= now(), queued_for_quiet_hours from public.messages where id = pg_temp.v('m1') $$,
  $$ values ('queued'::text, true, false) $$, 'staff queues an SMS for now');
select throws_ok($$ select public.queue_message(pg_temp.v('tk'), 'email', 'Body only') $$, '22023', null, 'email needs a subject');
select throws_ok($$ select public.queue_message(pg_temp.v('tk2'), 'email', 'Hello', 'Ready') $$, '22023', null,
  'no email address, no email');
select throws_ok($$ select public.queue_message(pg_temp.v('tk'), 'sms', '   ') $$, '22023', null, 'empty body rejected');
select throws_ok($$ insert into public.messages (shop_id, ticket_id, customer_id, channel, body)
  values (pg_temp.v('shop'), pg_temp.v('tk'), pg_temp.v('maria'), 'sms', 'x') $$, '42501', null, 'clients cannot insert messages directly');
select throws_ok($$ select * from public.claim_due_messages(10) $$, '42501', null, 'clients cannot claim messages');
select throws_ok($$ select public.record_sms_opt_out('4165550100', false) $$, '42501', null, 'clients cannot fake an inbound START');
select throws_ok($$ select public.record_delivery_status(pg_temp.v('m1'), 'twilio', 'SM1', 'delivered') $$, '42501', null,
  'clients cannot fake delivery status');
-- Opt-out enforced server-side.
select lives_ok($$ select public.set_customer_opt_out(pg_temp.v('maria'), 'sms', true) $$, 'staff can record an opt-out');
select throws_ok($$ select public.queue_message(pg_temp.v('tk'), 'sms', 'Hi again') $$, '42501', null,
  'an opted-out customer cannot be texted');
select is((select status::text from public.messages where id = pg_temp.v('m1')), 'canceled', 'their queued text was canceled');
select throws_ok($$ select public.set_customer_opt_out(pg_temp.v('maria'), 'sms', false) $$, '42501', null,
  'staff cannot opt a customer back in');
reset role;

select set_config('request.jwt.claims', '{"sub":"f1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.set_customer_opt_out(pg_temp.v('maria'), 'sms', false) $$, 'the owner can, with consent');
reset role;
select is((select count(*)::int from public.audit_log where action = 'customer.opt_out' and entity_id = pg_temp.v('maria')), 2,
  'opt-out changes are audited');

-- Unverified email.
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.queue_message(pg_temp.v('tk'), 'sms', 'Hi') $$, '42501', null,
  'a member without a confirmed email cannot send');
reset role;

-- Quiet hours: a window around "now" in Toronto defers to its end.
update public.shops set
  quiet_hours_start = ((now() at time zone 'America/Toronto') - interval '1 hour')::time,
  quiet_hours_end = ((now() at time zone 'America/Toronto') + interval '1 hour')::time
 where id = pg_temp.v('shop');
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
insert into t select 'mq', message_id::text from public.queue_message(pg_temp.v('tk'), 'email', 'Your coat is ready', 'Ready for pickup');
select results_eq($$ select queued_for_quiet_hours, scheduled_for > now(),
                       to_char(scheduled_for at time zone 'America/Toronto', 'HH24:MI')
                         = to_char((now() at time zone 'America/Toronto') + interval '1 hour', 'HH24:MI')
                      from public.messages where id = pg_temp.v('mq') $$,
  $$ values (true, true, true) $$, 'a message confirmed during quiet hours is scheduled for the end of quiet hours');
reset role;
update public.shops set quiet_hours_start = '00:00', quiet_hours_end = '00:00' where id = pg_temp.v('shop');

-- Rate limit per ticket (5 per hour; 2 already counted: m1 and mq).
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select public.queue_message(pg_temp.v('tk'), 'email', 'Note ' || g, 'Update') from generate_series(1, 3) g;
select throws_ok($$ select public.queue_message(pg_temp.v('tk'), 'email', 'One more', 'Update') $$, '54000', null,
  'a 6th message on one ticket within an hour is refused');
reset role;
-- Monthly SMS cap.
update public.shops set sms_monthly_cap = 1 where id = pg_temp.v('shop');
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
insert into t select 'm_pat', message_id::text from public.queue_message(pg_temp.v('tk2'), 'sms', 'Skis ready');
select throws_ok($$ select public.queue_message(pg_temp.v('tk2'), 'sms', 'Skis ready again') $$, '54000', null,
  'the monthly SMS cap is enforced');
select throws_ok($$ update public.shops set sms_monthly_cap = 9999 where id = pg_temp.v('shop') $$, '42501', null,
  'shops cannot raise their own SMS cap');
reset role;

-- Other shops.
select set_config('request.jwt.claims', '{"sub":"f2000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.messages), 0, 'another shop sees no messages');
select throws_ok($$ select public.queue_message(pg_temp.v('tk'), 'sms', 'Hi') $$, 'P0002', null, 'another shop cannot message our customer');
reset role;

-- ===== Service role: claim, send result, delivery, inbound STOP =========
-- Calls run as service_role; checks on the tables run as the test owner.
set local role service_role;
create temp table claimed as select * from public.claim_due_messages(50);
create temp table claimed_again as select * from public.claim_due_messages(50);
reset role;
select ok((select count(*) >= 4 from claimed), 'due messages are claimed');
select ok(not exists (select 1 from claimed where message_id = pg_temp.v('mq')), 'the quiet-hours message is not due yet');
select is((select recipient from claimed where message_id = pg_temp.v('m_pat')), '+14165550199', 'the SMS recipient is decrypted for sending');
select is((select reply_to is null and shop_name = 'F Repairs' from claimed where message_id = pg_temp.v('m_pat')), true, 'shop name and reply-to come along');
select is((select count(*)::int from claimed_again), 0, 'claimed messages are not handed out twice');
insert into t select 'm_email', message_id::text from claimed where channel = 'email' limit 1;

set local role service_role;
select public.record_send_result(pg_temp.v('m_pat'), true, 'twilio', 'SM123');
select public.record_delivery_status(pg_temp.v('m_pat'), 'twilio', 'SM123', 'delivered');
select public.record_delivery_status(pg_temp.v('m_pat'), 'twilio', 'SM123', 'sent');
reset role;
select is((select status::text from public.messages where id = pg_temp.v('m_pat')), 'delivered', 'a late "sent" does not undo "delivered"');
set local role service_role;
select public.record_delivery_status(pg_temp.v('m_pat'), 'twilio', 'SM-WRONG', 'failed');
select public.record_send_result(pg_temp.v('m_email'), false, 'resend', null, 'timeout', true);
create temp table stop_counts as select public.record_sms_opt_out('(416) 555-0100', true) as stop_n;
reset role;
select is((select status::text from public.messages where id = pg_temp.v('m_pat')), 'delivered', 'a status for a different provider id is ignored');
select results_eq($$ select status::text, error from public.messages where id = pg_temp.v('m_email') $$,
  $$ values ('queued'::text, 'timeout'::text) $$, 'a retryable failure goes back to the queue');
select ok((select stop_n from stop_counts) >= 2, 'STOP opts the number out in every shop that has it');
select ok((select bool_and(sms_opted_out) from public.customers where id in (pg_temp.v('maria'), pg_temp.v('maria_g'))), 'both customers opted out');
select ok(exists (select 1 from public.audit_log where action = 'customer.sms_stop'), 'inbound STOP is audited');
set local role service_role;
select is(public.record_sms_opt_out('not a phone', true), 0, 'junk numbers are ignored');
select ok(public.record_sms_opt_out('4165550100', false) >= 2, 'START opts back in');
reset role;
select ok((select not bool_or(sms_opted_out) from public.customers where id in (pg_temp.v('maria'), pg_temp.v('maria_g'))), 'both customers can be texted again');
set local role service_role;
reset role;

-- ===== Dispatch helpers =================================================
set local role service_role;
select is(public.provider_message_id_for(pg_temp.v('m_pat')), 'SM123', 'the stored SID is available to the webhook');
select public.record_send_result(pg_temp.v('mq'), true, 'resend', 're_1');
select public.record_email_complaint('re_1');
reset role;
select ok((select email_opted_out from public.customers where id = pg_temp.v('maria')), 'a spam complaint opts the customer out of email');
select ok(exists (select 1 from public.audit_log where action = 'customer.email_complaint'), 'and is audited');
select lives_ok($$ select private.dispatch_due_messages() $$, 'the dispatcher is a no-op without its Vault settings');
select ok(exists (select 1 from cron.job where jobname = 'mend-send-due-messages' and schedule = '* * * * *'), 'the dispatcher runs every minute');
select ok(not has_function_privilege('authenticated', 'public.provider_message_id_for(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.record_email_complaint(text)', 'execute'),
  'webhook helpers are not callable by users');

select is((select n.nspname::text from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_net'),
  'extensions', 'pg_net lives in the extensions schema, not public (advisor lint 0014)');

select * from finish();
rollback;
