-- Closed tickets are cleared after the shop's retention period (decision 86).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('ac000000-0000-0000-0000-000000000001', 'owner@ret.test', now(), '{}'),
  ('ac000000-0000-0000-0000-000000000002', 'staff@ret.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated;

select set_config('request.jwt.claims', '{"sub":"ac000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('Keep Shop', null, 'other', 'CA', null, 'America/Toronto')::text);
insert into t values ('c_gone', public.save_customer(pg_temp.v('shop'), null, 'Gone Customer', '416 555 0101')::text);
insert into t values ('c_kept', public.save_customer(pg_temp.v('shop'), null, 'Paid Customer', '416 555 0102')::text);
insert into t values ('c_new', public.save_customer(pg_temp.v('shop'), null, 'Recent Customer', '416 555 0103')::text);
insert into t select 'tk_plain', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('c_gone'), 'Old coat');
insert into t select 'tk_paid', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('c_kept'), 'Paid coat');
insert into t select 'tk_soon', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('c_new'), 'Soon coat');
insert into t select 'tk_open', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('c_new'), 'Open coat');
insert into t select 'tk_photo', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('c_new'), 'Photo coat');
select public.add_ticket_note(pg_temp.v('tk_paid'), 'Customer said the lining is silk');
reset role;

-- Close three tickets 13 months ago, one 11.5 months ago; leave one open.
update public.tickets set
    status_id = (select id from public.statuses where shop_id = pg_temp.v('shop') and is_final limit 1),
    picked_up_at = now() - interval '13 months', status_changed_at = now() - interval '13 months',
    internal_notes = 'side seam', issue_description = 'zip broken'
  where id in (pg_temp.v('tk_plain'), pg_temp.v('tk_paid'), pg_temp.v('tk_photo'));
update public.tickets set
    status_id = (select id from public.statuses where shop_id = pg_temp.v('shop') and is_final limit 1),
    picked_up_at = now() - interval '11 months 15 days'
  where id = pg_temp.v('tk_soon');
update public.tickets set created_at = now() - interval '2 years' where id = pg_temp.v('tk_open');
update public.customers set created_at = now() - interval '14 months'
  where id in (pg_temp.v('c_gone'), pg_temp.v('c_kept'));
insert into public.payments (shop_id, ticket_id, kind, method, amount_cents, paid_on)
  values (pg_temp.v('shop'), pg_temp.v('tk_paid'), 'payment', 'cash', 4500, (now() - interval '13 months')::date);
insert into public.messages (shop_id, ticket_id, customer_id, channel, body, status)
  values (pg_temp.v('shop'), pg_temp.v('tk_paid'), pg_temp.v('c_kept'), 'email', 'Your coat is ready', 'sent');
insert into public.ticket_photos (shop_id, ticket_id, storage_path)
  values (pg_temp.v('shop'), pg_temp.v('tk_photo'),
          pg_temp.v('shop')::text || '/' || pg_temp.v('tk_photo')::text || '/front.jpg');

-- The banner: Owner/Admin only; counts what is due within 30 days.
select set_config('request.jwt.claims', '{"sub":"ac000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is((select tickets_due from public.retention_notice(pg_temp.v('shop'))), 4, 'the notice counts 3 overdue + 1 due within 30 days');
select is((select retention_months from public.retention_notice(pg_temp.v('shop'))), 12, 'default retention is 12 months');
select throws_ok($$ select public.retention_run() $$, '42501', null, 'members cannot run the purge');
select throws_ok($$ select * from public.retention_claim_photos(10) $$, '42501', null, 'members cannot claim photos');
reset role;
select set_config('request.jwt.claims', '{"sub":"ac000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select * from public.retention_notice(pg_temp.v('shop')) $$, '42501', null, 'a non-member cannot see the notice');
reset role;

-- A hold stops everything.
update public.shops set retention_hold = true where id = pg_temp.v('shop');
select public.retention_run();
select ok(exists (select 1 from public.tickets where id = pg_temp.v('tk_plain')), 'held shop: nothing is deleted');
select is((select count(*)::int from private.retention_upcoming where shop_id = pg_temp.v('shop') and retention_hold), 1,
  'held shops still show in the upcoming list');
update public.shops set retention_hold = false where id = pg_temp.v('shop');

-- Photos first: the ticket with a photo waits until its files are gone.
select is((select count(*)::int from public.retention_claim_photos(10)), 1, 'the due photo is claimed');
select is((select tickets_deleted from jsonb_to_record(public.retention_run()) as x(tickets_deleted int)), 1,
  'one plain ticket deleted (the photo one waits)');

select ok(not exists (select 1 from public.tickets where id = pg_temp.v('tk_plain')), 'a ticket with no money is deleted');
select ok(not exists (select 1 from public.customers where id = pg_temp.v('c_gone')), 'its customer with no other ticket is deleted');

select ok(exists (select 1 from public.tickets where id = pg_temp.v('tk_paid') and retention_purged_at is not null),
  'a paid ticket is kept and marked cleared');
select is((select row(internal_notes, issue_description)::text from public.tickets where id = pg_temp.v('tk_paid')), '(,)',
  'its notes and description are cleared');
select is((select count(*)::int from public.messages where ticket_id = pg_temp.v('tk_paid')), 0, 'its messages are deleted');
select is((select count(*)::int from public.ticket_events where ticket_id = pg_temp.v('tk_paid')), 0, 'its timeline is deleted, with no new edit event');
select is((select count(*)::int from public.payments where ticket_id = pg_temp.v('tk_paid')), 1, 'its payment is kept');
select is((select row(name, phone_encrypted is null, retention_purged_at is not null)::text from public.customers where id = pg_temp.v('c_kept')),
  '("Paid Customer",t,t)', 'its customer keeps the name only');

select ok(exists (select 1 from public.tickets where id = pg_temp.v('tk_soon') and retention_purged_at is null), 'a ticket not yet due is untouched');
select ok(exists (select 1 from public.tickets where id = pg_temp.v('tk_open') and retention_purged_at is null), 'an open ticket is never touched');
select ok(exists (select 1 from public.customers where id = pg_temp.v('c_new') and phone_encrypted is not null), 'a customer with current tickets is untouched');
select ok(exists (select 1 from public.audit_log where shop_id = pg_temp.v('shop') and action = 'retention.purged'), 'the run is audited');

-- After the Edge Function deletes the file, the photo ticket goes too.
select is(public.retention_photos_removed(array(select photo_id from public.retention_claim_photos(10))), 1, 'photo row removed');
select public.retention_run();
select ok(not exists (select 1 from public.tickets where id = pg_temp.v('tk_photo')), 'then the photo ticket is deleted');

-- Money records go after the tax-record period.
update public.tickets set retention_purged_at = now() - interval '9 years' where id = pg_temp.v('tk_paid');
update public.payments set paid_on = (now() - interval '9 years')::date where ticket_id = pg_temp.v('tk_paid');
select is((select money_records_expired from jsonb_to_record(public.retention_run()) as x(money_records_expired int)), 1,
  'a paid ticket is deleted after the tax-record period');
select ok(not exists (select 1 from public.customers where id = pg_temp.v('c_kept')), 'and then its customer');

select * from finish();
rollback;
