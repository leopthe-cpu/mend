-- Phase 2 acceptance (docs/spec.md §9 Phase 2): encrypted contact data, blind
-- index search, cross-shop isolation for customers/tickets/photos, passcode
-- reveal rules + audit + purge on pickup, numbering, deletion rights.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('a1000000-0000-0000-0000-000000000001', 'owner@a.test', now(), '{}'),
  ('a1000000-0000-0000-0000-000000000002', 'staff1@a.test', now(), '{}'),
  ('a1000000-0000-0000-0000-000000000003', 'staff2@a.test', now(), '{}'),
  ('b1000000-0000-0000-0000-000000000001', 'owner@b.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;

-- Shops (as owners), then staff added directly (setup only).
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop_a', public.create_shop('A Repairs', null, 'electronics', 'CA', null, 'America/Toronto')::text);
reset role;
select set_config('request.jwt.claims', '{"sub":"b1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop_b', public.create_shop('B Repairs', null, 'ski', 'CA', null, 'America/Toronto')::text);
reset role;
insert into public.memberships (shop_id, user_id, role) values
  ((select v::uuid from t where k = 'shop_a'), 'a1000000-0000-0000-0000-000000000002', 'staff'),
  ((select v::uuid from t where k = 'shop_a'), 'a1000000-0000-0000-0000-000000000003', 'staff');

-- ===== Customers ======================================================
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('cust', public.save_customer((select v::uuid from t where k = 'shop_a'), null, 'Maria Rossi', '(416) 555-0100', 'Maria@Example.com')::text);
select throws_ok($$ select public.save_customer((select v::uuid from t where k = 'shop_a'), null, 'No Contact') $$, '22023', null, 'a customer needs a phone or an email');
select throws_ok($$ select public.save_customer((select v::uuid from t where k = 'shop_a'), null, 'Bad', '123') $$, '22023', null, 'invalid phone rejected');
select throws_ok($$ select phone_encrypted from public.customers $$, '42501', null, 'clients cannot read encrypted phone column');
select throws_ok($$ select email_hash from public.customers $$, '42501', null, 'clients cannot read blind indexes');
select results_eq($$ select phone, email from public.customer_contacts(array[(select v::uuid from t where k = 'cust')]) $$,
  $$ values ('+14165550100'::text, 'maria@example.com'::text) $$, 'members get decrypted, normalized contact data');
select results_eq($$ select kind, label from public.search_shop((select v::uuid from t where k = 'shop_a'), '416-555-0100') $$,
  $$ values ('customer'::text, 'Maria Rossi'::text) $$, 'exact phone search works through the blind index (any format)');
select results_eq($$ select kind, label from public.search_shop((select v::uuid from t where k = 'shop_a'), 'MARIA@example.com') $$,
  $$ values ('customer'::text, 'Maria Rossi'::text) $$, 'exact email search works (case-insensitive)');
select results_eq($$ select count(*)::int from public.search_shop((select v::uuid from t where k = 'shop_a'), 'mari') $$,
  $$ values (1) $$, 'name search works');
reset role;

select ok((select position('4165550100' in encode(phone_encrypted, 'escape')) = 0 from public.customers where name = 'Maria Rossi'),
  'raw phone is not stored in the table');
select ok((select position('maria' in encode(email_encrypted, 'escape')) = 0 from public.customers where name = 'Maria Rossi'),
  'raw email is not stored in the table');
select ok((select phone_hash is not null and length(phone_hash) = 64 from public.customers where name = 'Maria Rossi'), 'blind index stored');

-- ===== Tickets ========================================================
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
insert into t select 'tk1', ticket_id::text from public.create_ticket((select v::uuid from t where k = 'shop_a'), (select v::uuid from t where k = 'cust'),
  'iPhone 13', 'Cracked screen', null, null, 'a1000000-0000-0000-0000-000000000003', '{}', '1234', true);
insert into t select 'tk2', ticket_id::text from public.create_ticket((select v::uuid from t where k = 'shop_a'), (select v::uuid from t where k = 'cust'), 'iPad');
select results_eq($$ select ticket_number from public.tickets order by ticket_number $$, $$ values (1001), (1002) $$, 'per-shop ticket numbers start at 1001 and increment');
select results_eq($$ select status.name from public.tickets tk join public.statuses status on status.id = tk.status_id where tk.id = (select v::uuid from t where k = 'tk1') $$,
  $$ values ('Received'::text) $$, 'new tickets start in the first status');
select ok((select has_passcode from public.tickets where id = (select v::uuid from t where k = 'tk1')), 'has_passcode is visible, the passcode is not');
select throws_ok($$ select passcode_encrypted from public.tickets $$, '42501', null, 'clients cannot read the encrypted passcode');
select throws_ok($$ select public.create_ticket((select v::uuid from t where k = 'shop_a'), (select v::uuid from t where k = 'cust'), 'X', null, null, null, null,
  jsonb_build_object((select id::text from public.custom_field_definitions where label = 'Device model'), 42)) $$, '22023', null, 'custom fields are validated against their type');
select throws_ok($$ update public.tickets set ticket_number = 1 $$, '42501', null, 'ticket numbers are not client-writable');
select throws_ok($$ update public.tickets set status_id = status_id $$, '42501', null, 'status changes only through set_ticket_status');
select lives_ok($$ update public.tickets set promised_date = current_date + 3 where id = (select v::uuid from t where k = 'tk1') $$, 'members edit ticket details');
select ok(exists (select 1 from public.ticket_events where type = 'edit'), 'edits appear on the timeline');
-- Passcode: staff1 is NOT the assignee.
select throws_ok($$ select public.reveal_passcode((select v::uuid from t where k = 'tk1')) $$, '42501', null, 'unassigned staff cannot reveal the passcode');
select throws_ok($$ select public.delete_ticket((select v::uuid from t where k = 'tk2')) $$, '42501', null, 'staff cannot delete tickets');
reset role;

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select is(public.reveal_passcode((select v::uuid from t where k = 'tk1')), '1234', 'the assigned staff member can reveal the passcode');
reset role;

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.reveal_passcode((select v::uuid from t where k = 'tk1')), '1234', 'the owner can reveal the passcode');
select ok((select count(*) = 2 from public.audit_log where action = 'passcode.revealed'), 'every reveal is in the audit log');
select ok((select count(*) = 2 from public.ticket_events where type = 'passcode_revealed'), 'every reveal is on the timeline');
select lives_ok($$ select public.set_ticket_status((select v::uuid from t where k = 'tk1'), (select id from public.statuses where name = 'Picked up' and shop_id = (select v::uuid from t where k = 'shop_a'))) $$,
  'move to Picked up');
select ok((select not has_passcode and picked_up_at is not null from public.tickets where id = (select v::uuid from t where k = 'tk1')), 'passcode purged on pickup');
select is(public.reveal_passcode((select v::uuid from t where k = 'tk1')), null, 'nothing left to reveal after pickup');
select ok(exists (select 1 from public.ticket_events where type = 'passcode_purged'), 'purge recorded on the timeline');
select throws_ok($$ select public.set_ticket_status((select v::uuid from t where k = 'tk2'), (select id from public.statuses where shop_id = (select v::uuid from t where k = 'shop_b') limit 1)) $$,
  'P0002', null, 'cannot move a ticket to another shop''s status');
select lives_ok($$ select public.delete_ticket((select v::uuid from t where k = 'tk2')) $$, 'owner deletes a ticket');
select is((select count(*)::int from public.tickets where id = (select v::uuid from t where k = 'tk2')), 0, 'deleted tickets disappear');
select ok(exists (select 1 from public.audit_log where action = 'ticket.deleted' and old_values ->> 'item_name' = 'iPad'), 'deletion audited with old values');
reset role;

-- ===== Photos =========================================================
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(format($$ insert into storage.objects (bucket_id, name, owner_id) values ('ticket-photos', '%s/%s/front.jpg', 'a1000000-0000-0000-0000-000000000002') $$,
  (select v from t where k = 'shop_a'), (select v from t where k = 'tk1')), 'member uploads a photo into their shop folder');
select lives_ok(format($$ insert into public.ticket_photos (shop_id, ticket_id, storage_path) values ('%s', '%s', '%s/%s/front.jpg') $$,
  (select v from t where k = 'shop_a'), (select v from t where k = 'tk1'), (select v from t where k = 'shop_a'), (select v from t where k = 'tk1')), 'photo row recorded');
select throws_ok(format($$ insert into public.ticket_photos (shop_id, ticket_id, storage_path) values ('%s', '%s', 'elsewhere/front.jpg') $$,
  (select v from t where k = 'shop_a'), (select v from t where k = 'tk1')), '23514', null, 'photo path must sit under shop/ticket');
reset role;

-- ===== Shop B against shop A ==========================================
select set_config('request.jwt.claims', '{"sub":"b1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.customers), 0, 'B cannot read A''s customers');
select is((select count(*)::int from public.customer_contacts(array[(select v::uuid from t where k = 'cust')])), 0, 'B cannot decrypt A''s customer contacts');
select is((select count(*)::int from public.search_shop((select v::uuid from t where k = 'shop_a'), '416 555 0100')), 0, 'B cannot search A');
select is((select count(*)::int from public.tickets), 0, 'B cannot read A''s tickets');
select is((select count(*)::int from public.ticket_events), 0, 'B cannot read A''s timeline');
select is((select count(*)::int from public.ticket_photos), 0, 'B cannot read A''s photo records');
select is((select count(*)::int from storage.objects where bucket_id = 'ticket-photos'), 0, 'B cannot read A''s photo files');
select throws_ok(format($$ insert into storage.objects (bucket_id, name, owner_id) values ('ticket-photos', '%s/x/evil.jpg', 'b1000000-0000-0000-0000-000000000001') $$,
  (select v from t where k = 'shop_a')), '42501', null, 'B cannot upload into A''s folder');
select is_empty($$ update public.tickets set item_name = 'Hacked' returning 1 $$, 'B cannot edit A''s tickets');
select throws_ok($$ select public.reveal_passcode((select v::uuid from t where k = 'tk1')) $$, 'P0002', null, 'B cannot reveal A''s passcodes');
select throws_ok($$ select public.save_customer((select v::uuid from t where k = 'shop_a'), null, 'Evil', '4165550199') $$, '42501', null, 'B cannot add customers to A');
select throws_ok($$ select public.create_ticket((select v::uuid from t where k = 'shop_a'), (select v::uuid from t where k = 'cust'), 'Evil') $$, '42501', null, 'B cannot create tickets in A');
select throws_ok($$ select public.create_ticket((select v::uuid from t where k = 'shop_b'), (select v::uuid from t where k = 'cust'), 'Evil') $$, 'P0002', null, 'B cannot attach A''s customer to a B ticket');
reset role;

select * from finish();
rollback;
