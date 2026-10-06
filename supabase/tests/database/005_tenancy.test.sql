-- Phase 1B acceptance (docs/spec.md §9 Phase 1 + addendum §8):
-- two shops, every role, invites, removal, ownership, atomic onboarding.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- People. A: owner, admin, staff. B: owner. Plus an outsider and an
-- unconfirmed signup.
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000001', 'owner.a@test.local', now(), '{}'),
  ('a0000000-0000-0000-0000-000000000002', 'admin.a@test.local', now(), '{}'),
  ('a0000000-0000-0000-0000-000000000003', 'staff.a@test.local', now(), '{}'),
  ('b0000000-0000-0000-0000-000000000001', 'owner.b@test.local', now(), '{}'),
  ('c0000000-0000-0000-0000-000000000001', 'outsider@test.local', now(), '{}'),
  ('c0000000-0000-0000-0000-000000000002', 'unconfirmed@test.local', null, '{}');

-- Scratch space shared across role switches.
create temp table t (k text primary key, v text);
grant all on t to authenticated, anon;

-- ===== Onboarding =====================================================
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.create_shop('Nope') $$, '42501', null, 'unconfirmed email cannot create a shop');

reset role;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.create_shop('Half Shop', null, 'electronics', 'CA', null, 'America/Toronto', null, null, null, '{}', '[{"name":"Bad","rate":500}]') $$,
  null, null, 'a failure midway (invalid tax rate) aborts onboarding');
reset role;
select is((select count(*)::int from public.shops where created_by = 'c0000000-0000-0000-0000-000000000001'), 0,
  'onboarding is atomic: no partial shop left behind');
select is((select count(*)::int from public.memberships where user_id = 'c0000000-0000-0000-0000-000000000001'), 0,
  'onboarding is atomic: no membership left behind');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop_a', public.create_shop('Shop A', 'Alice Owner', 'electronics', 'CA', null, 'America/Toronto', null, null, null, '{}', '[{"name":"HST","rate":13}]')::text);
select throws_ok($$ select public.create_shop('Second') $$, '23505', null, 'one shop per user in the MVP');

reset role;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop_b', public.create_shop(null, null, 'ski', 'US', null, 'America/Denver')::text);
select ok((select char_length(name) > 3 from public.shops where id = (select v::uuid from t where k = 'shop_b')),
  'a skipped shop name gets a generated one');
select is((select currency from public.shops where id = (select v::uuid from t where k = 'shop_b')), 'USD',
  'currency follows the country');
reset role;

select is((select count(*)::int from public.statuses where shop_id = (select v::uuid from t where k = 'shop_a')), 7, 'electronics: 7 statuses seeded');
select is((select count(*)::int from public.statuses where shop_id = (select v::uuid from t where k = 'shop_a') and is_final), 1, 'exactly one final status');
select is((select count(*)::int from public.custom_field_definitions where shop_id = (select v::uuid from t where k = 'shop_a')), 2, 'electronics: 2 custom fields');
select is((select count(*)::int from public.catalog_items where shop_id = (select v::uuid from t where k = 'shop_a')), 5, 'electronics: 5 starter catalog items');
select is((select count(*)::int from public.catalog_item_tax_rates where shop_id = (select v::uuid from t where k = 'shop_a')), 5, 'starter items carry the HST rate');
select is((select count(*)::int from public.message_templates where shop_id = (select v::uuid from t where k = 'shop_a')), 2, 'Ready has SMS and email templates');
select is((select count(*)::int from public.statuses where shop_id = (select v::uuid from t where k = 'shop_b')), 4, 'ski: 4 statuses seeded');
select is((select full_name from public.profiles where user_id = 'a0000000-0000-0000-0000-000000000001'), 'Alice Owner', 'owner name saved to profile');
select is((select role::text from public.memberships where user_id = 'a0000000-0000-0000-0000-000000000001'), 'owner', 'creator is the Owner');

-- ===== Invites ========================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t select 'tok_admin', token from public.create_invite((select v::uuid from t where k = 'shop_a'), 'Admin.A@test.local', 'admin');
insert into t select 'tok_staff', token from public.create_invite((select v::uuid from t where k = 'shop_a'), 'staff.a@test.local', 'staff');
insert into t select 'tok_expired', token from public.create_invite((select v::uuid from t where k = 'shop_a'), 'late@test.local', 'staff');
insert into t select 'tok_revoked', token from public.create_invite((select v::uuid from t where k = 'shop_a'), 'revoked@test.local', 'staff');
select throws_ok($$ select * from public.create_invite((select v::uuid from t where k = 'shop_a'), 'x@test.local', 'owner') $$,
  '42501', null, 'nobody can invite an Owner');
select throws_ok($$ select token_hash from public.invites $$, '42501', null, 'token hashes are never readable');
select is((select count(*)::int from public.invites), 4, 'Owner sees the shop''s invites');
select lives_ok($$ select public.revoke_invite((select id from public.invites where email = 'revoked@test.local')) $$, 'Owner can revoke an invite');
reset role;
update public.invites set expires_at = now() - interval '1 minute' where email = 'late@test.local';

select is((select length(v) from t where k = 'tok_admin'), 64, 'token is 256 random bits (64 hex chars)');
select isnt((select token_hash from public.invites where email = 'admin.a@test.local'), (select v from t where k = 'tok_admin'), 'only a hash of the token is stored');

set local role anon;
select results_eq($$ select shop_name, role::text, status from public.invite_preview((select v from t where k = 'tok_admin')) $$,
  $$ values ('Shop A'::text, 'admin'::text, 'valid'::text) $$, 'anyone with the link sees shop name and role');
select results_eq($$ select status from public.invite_preview('not-a-token') $$, $$ values ('invalid'::text) $$, 'garbage tokens reveal nothing');
reset role;

-- Wrong email
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.accept_invite((select v from t where k = 'tok_staff')) $$, '42501', null, 'wrong-email invite is rejected');
reset role;
-- Expired / revoked
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.accept_invite((select v from t where k = 'tok_expired')) $$, '22023', 'invite expired', 'expired invite is rejected');
select throws_ok($$ select public.accept_invite((select v from t where k = 'tok_revoked')) $$, '22023', 'invite revoked', 'revoked invite is rejected');
select lives_ok($$ select public.accept_invite((select v from t where k = 'tok_staff')) $$, 'staff accepts a valid invite');
select throws_ok($$ select public.accept_invite((select v from t where k = 'tok_staff')) $$, '22023', 'invite already used', 'reused invite is rejected');
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.accept_invite((select v from t where k = 'tok_admin')) $$, 'admin accepts (email match is case-insensitive)');
reset role;
select is((select role::text from public.memberships where user_id = 'a0000000-0000-0000-0000-000000000002'), 'admin', 'admin joined with the invited role');

-- ===== Cross-tenant isolation: B's owner against every A table ========
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.shops where id = (select v::uuid from t where k = 'shop_a')), 0, 'B cannot read A: shops');
select is((select count(*)::int from public.memberships where shop_id = (select v::uuid from t where k = 'shop_a')), 0, 'B cannot read A: memberships');
select is((select count(*)::int from public.invites where shop_id = (select v::uuid from t where k = 'shop_a')), 0, 'B cannot read A: invites');
select is((select count(*)::int from public.audit_log where shop_id = (select v::uuid from t where k = 'shop_a')), 0, 'B cannot read A: audit_log');
select is((select count(*)::int from public.statuses where shop_id = (select v::uuid from t where k = 'shop_a')), 0, 'B cannot read A: statuses');
select is((select count(*)::int from public.custom_field_definitions where shop_id = (select v::uuid from t where k = 'shop_a')), 0, 'B cannot read A: custom fields');
select is((select count(*)::int from public.message_templates where shop_id = (select v::uuid from t where k = 'shop_a')), 0, 'B cannot read A: templates');
select is((select count(*)::int from public.tax_rates where shop_id = (select v::uuid from t where k = 'shop_a')), 0, 'B cannot read A: tax rates');
select is((select count(*)::int from public.catalog_items where shop_id = (select v::uuid from t where k = 'shop_a')), 0, 'B cannot read A: catalog');
select is((select count(*)::int from public.catalog_item_tax_rates where shop_id = (select v::uuid from t where k = 'shop_a')), 0, 'B cannot read A: catalog tax links');
select is((select count(*)::int from public.profiles where user_id = 'a0000000-0000-0000-0000-000000000001'), 0, 'B cannot read A: profiles');
select throws_ok($$ insert into public.statuses (shop_id, name, position, category) values ((select v::uuid from t where k = 'shop_a'), 'Hacked', 99, 'open') $$,
  '42501', null, 'B cannot insert into A');
select is_empty($$ update public.statuses set name = 'Hacked' where shop_id = (select v::uuid from t where k = 'shop_a') returning 1 $$, 'B cannot update A');
select is_empty($$ delete from public.catalog_items where shop_id = (select v::uuid from t where k = 'shop_a') returning 1 $$, 'B cannot delete A');
select is_empty($$ update public.shops set name = 'Hacked' where id = (select v::uuid from t where k = 'shop_a') returning 1 $$, 'B cannot rename A');
select throws_ok($$ select * from public.create_invite((select v::uuid from t where k = 'shop_a'), 'evil@test.local', 'staff') $$, '42501', null, 'B cannot invite into A');
select throws_ok($$ select public.remove_member((select v::uuid from t where k = 'shop_a'), 'a0000000-0000-0000-0000-000000000003') $$, '42501', null, 'B cannot remove A''s members');
select throws_ok($$ insert into public.memberships (shop_id, user_id, role) values ((select v::uuid from t where k = 'shop_a'), 'b0000000-0000-0000-0000-000000000001', 'owner') $$,
  '42501', null, 'nobody can write memberships directly');
reset role;

-- ===== Roles inside shop A ============================================
-- Staff
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.statuses), 7, 'staff reads own shop config');
select is((select count(*)::int from public.audit_log), 0, 'staff cannot read the audit log');
select is((select count(*)::int from public.invites), 0, 'staff cannot see invites');
select throws_ok($$ insert into public.statuses (shop_id, name, position, category) values ((select v::uuid from t where k = 'shop_a'), 'X', 99, 'open') $$, '42501', null, 'staff cannot change statuses');
select is_empty($$ update public.shops set name = 'Staff Shop' returning 1 $$, 'staff cannot edit shop settings');
select throws_ok($$ select * from public.create_invite((select v::uuid from t where k = 'shop_a'), 'y@test.local', 'staff') $$, '42501', null, 'staff cannot invite');
select is((select count(*)::int from public.profiles), 3, 'coworkers can see each other''s names');
reset role;

-- Admin
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ insert into public.statuses (shop_id, name, position, category) values ((select v::uuid from t where k = 'shop_a'), 'Quality check', 8, 'open') $$, 'admin can add a status');
select throws_ok($$ insert into public.catalog_items (shop_id, name, item_type) values ((select v::uuid from t where k = 'shop_a'), 'Admin item', 'service') $$, '42501', null, 'admin cannot edit the catalog (Owner only)');
select throws_ok($$ select * from public.create_invite((select v::uuid from t where k = 'shop_a'), 'admin2@test.local', 'admin') $$, '42501', null, 'admin cannot invite an Admin');
select lives_ok($$ select * from public.create_invite((select v::uuid from t where k = 'shop_a'), 'staff2@test.local', 'staff') $$, 'admin can invite Staff');
select throws_ok($$ select public.change_member_role((select v::uuid from t where k = 'shop_a'), 'a0000000-0000-0000-0000-000000000003', 'admin') $$, '42501', null, 'admin cannot promote to Admin');
select throws_ok($$ select public.remove_member((select v::uuid from t where k = 'shop_a'), 'a0000000-0000-0000-0000-000000000001') $$, '42501', null, 'admin cannot remove the Owner');
select throws_ok($$ select public.transfer_ownership((select v::uuid from t where k = 'shop_a'), 'a0000000-0000-0000-0000-000000000002') $$, '42501', null, 'admin cannot take ownership');
select ok((select count(*) > 0 from public.audit_log), 'admin can read the audit log');
select lives_ok($$ update public.shops set phone = '+1 416 555 0100' where id = (select v::uuid from t where k = 'shop_a') $$, 'admin can edit shop settings');
select throws_ok($$ update public.shops set next_ticket_number = 1 $$, '42501', null, 'counters are never client-writable');
reset role;

-- Owner
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ insert into public.catalog_items (shop_id, name, item_type, price_cents) values ((select v::uuid from t where k = 'shop_a'), 'Charging port', 'service', 8900) $$, 'owner can edit the catalog');
select throws_ok($$ select public.change_member_role((select v::uuid from t where k = 'shop_a'), 'a0000000-0000-0000-0000-000000000001', 'admin') $$, '42501', null, 'the Owner cannot be demoted');
select throws_ok($$ select public.remove_member((select v::uuid from t where k = 'shop_a'), 'a0000000-0000-0000-0000-000000000001') $$, '42501', null, 'the Owner cannot be removed');
select throws_ok($$ select public.transfer_ownership((select v::uuid from t where k = 'shop_a'), 'a0000000-0000-0000-0000-000000000002') $$, '42501', null, 'transfer needs a fresh password check');
select lives_ok($$ select public.change_member_role((select v::uuid from t where k = 'shop_a'), 'a0000000-0000-0000-0000-000000000003', 'admin') $$, 'owner can promote staff to admin');
select lives_ok($$ select public.change_member_role((select v::uuid from t where k = 'shop_a'), 'a0000000-0000-0000-0000-000000000003', 'staff') $$, 'owner can demote admin to staff');
-- Removal takes effect immediately.
select lives_ok($$ select public.remove_member((select v::uuid from t where k = 'shop_a'), 'a0000000-0000-0000-0000-000000000003') $$, 'owner removes staff');
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.shops), 0, 'removed member loses access on the next request (same JWT)');
select is((select count(*)::int from public.statuses), 0, 'removed member sees no shop data');
reset role;

-- Ownership transfer with a fresh password sign-in in the JWT.
select set_config('request.jwt.claims', json_build_object(
  'sub', 'a0000000-0000-0000-0000-000000000001', 'role', 'authenticated', 'aal', 'aal1',
  'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint)))::text, true);
set local role authenticated;
select lives_ok($$ select public.transfer_ownership((select v::uuid from t where k = 'shop_a'), 'a0000000-0000-0000-0000-000000000002') $$, 'owner transfers ownership after re-entering the password');
reset role;
select is((select role::text from public.memberships where user_id = 'a0000000-0000-0000-0000-000000000002'), 'owner', 'new owner');
select is((select role::text from public.memberships where user_id = 'a0000000-0000-0000-0000-000000000001'), 'admin', 'old owner becomes Admin');
select is((select count(*)::int from public.memberships where shop_id = (select v::uuid from t where k = 'shop_a') and role = 'owner'), 1, 'still exactly one owner');

-- ===== Audit log ======================================================
select ok((select count(*) >= 8 from public.audit_log where shop_id = (select v::uuid from t where k = 'shop_a')), 'team and settings changes are audited');
select ok(exists (select 1 from public.audit_log where action = 'member.removed'), 'member removal audited');
select ok(exists (select 1 from public.audit_log where action = 'shop.ownership_transferred'), 'ownership transfer audited');
select ok(exists (select 1 from public.audit_log where action = 'catalog_items.insert' and new_values ->> 'price_cents' = '8900'), 'catalog price change audited with values');
select ok(exists (select 1 from public.audit_log where action = 'shops.update' and new_values ->> 'phone' = '+1 416 555 0100'), 'settings change audited with old and new values');
select throws_ok($$ update public.audit_log set action = 'x' $$, '42501', null, 'audit log cannot be edited (even by the table owner)');
select throws_ok($$ delete from public.audit_log $$, '42501', null, 'audit log cannot be deleted');

select * from finish();
rollback;
