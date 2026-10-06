-- In-app onboarding (decision 53) and the shoe/leather and watch trades
-- (decision 52): the shop is created with defaults, the Owner finishes setup
-- once, the trade can only change while there are no tickets, and nothing the
-- shop added is removed by a trade change.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('d1000000-0000-0000-0000-000000000001', 'owner@h.test', now(), '{}'),
  ('d1000000-0000-0000-0000-000000000002', 'staff@h.test', now(), '{}'),
  ('d2000000-0000-0000-0000-000000000001', 'owner@i.test', now(), '{}'),
  ('d3000000-0000-0000-0000-000000000001', 'owner@j.test', now(), '{}'),
  ('d4000000-0000-0000-0000-000000000001', 'owner@k.test', now(), '{}'),
  ('d5000000-0000-0000-0000-000000000001', 'invited@l.test', now(), '{}'),
  ('d5000000-0000-0000-0000-000000000002', 'fresh@l.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated;

-- ===== New trades seed their own starter setup ==========================
select set_config('request.jwt.claims', '{"sub":"d3000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shoe', public.create_shop('J Cobbler', null, 'shoe_leather', 'CA', null, 'America/Toronto')::text);
reset role;
select set_config('request.jwt.claims', '{"sub":"d4000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('watch', public.create_shop('K Watches', null, 'watch', 'CA', null, 'America/Toronto')::text);
reset role;

select is((select count(*)::int from public.statuses where shop_id = pg_temp.v('shoe')), 5, 'shoe & leather: 5 statuses');
select is((select count(*)::int from public.custom_field_definitions where shop_id = pg_temp.v('shoe')), 3, 'shoe & leather: 3 fields');
select is((select count(*)::int from public.catalog_items where shop_id = pg_temp.v('shoe')), 8, 'shoe & leather: 8 starter items');
select is((select count(*)::int from public.statuses where shop_id = pg_temp.v('watch')), 8, 'watch: 8 statuses');
select is((select count(*)::int from public.custom_field_definitions where shop_id = pg_temp.v('watch')), 4, 'watch: 4 fields');
select is((select count(*)::int from public.catalog_items where shop_id = pg_temp.v('watch')), 7, 'watch: 7 starter items');
select is((select count(*)::int from public.message_templates where shop_id = pg_temp.v('watch')), 2, 'watch: Ready has SMS and email templates');

-- ===== Default shop, then setup inside the app ==========================
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
-- What the app calls on first entry: everything defaulted.
insert into t values ('shop', public.create_shop(null, null, 'other', 'CA', null, 'America/Toronto')::text);
insert into t select 'final', id::text from public.statuses where shop_id = pg_temp.v('shop') and is_final;
-- Something the Owner added before finishing setup must survive a trade change.
insert into t values ('mine', public.save_catalog_item(pg_temp.v('shop'), null, 'Rush fee', null, 'service', 'each', 1500)::text);
reset role;

select ok((select setup_completed_at is null from public.shops where id = pg_temp.v('shop')), 'a new shop starts with setup unfinished');

insert into public.memberships (shop_id, user_id, role) values (pg_temp.v('shop'), 'd1000000-0000-0000-0000-000000000002', 'staff');

-- The flag can't be set directly by a member.
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ update public.shops set setup_completed_at = now() where id = pg_temp.v('shop') $$,
  '42501', null, 'setup_completed_at is not client-writable');
reset role;

select set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.finish_shop_setup(pg_temp.v('shop'), 'Staff Shop') $$,
  '42501', null, 'staff cannot finish setup');
reset role;
select set_config('request.jwt.claims', '{"sub":"d2000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.finish_shop_setup(pg_temp.v('shop'), 'Hijack') $$,
  '42501', null, 'another shop''s owner cannot finish setup');
reset role;

select set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.finish_shop_setup(pg_temp.v('shop'), 'H Watch Co', null, 'watch', 'US', 'America/Denver', null, null, null,
       '[{"name":"A","rate":1},{"name":"B","rate":1},{"name":"C","rate":1},{"name":"D","rate":1},{"name":"E","rate":1},{"name":"F","rate":1}]') $$,
  '22023', null, 'more than 5 tax rates is refused');
select ok((select setup_completed_at is null and vertical = 'other' from public.shops where id = pg_temp.v('shop')),
  'a refused setup changes nothing');

select lives_ok(
  $$ select public.finish_shop_setup(pg_temp.v('shop'), ' H Watch Co ', 'Hana Owner', 'watch', 'US', 'America/Denver',
       '1 Main St', '303 555 0100', '{"text":"Mon-Fri 10-6"}', '[{"name":"Sales tax","rate":8.25}]') $$,
  'the owner finishes setup with a new trade');
reset role;

select is((select name from public.shops where id = pg_temp.v('shop')), 'H Watch Co', 'name saved (trimmed)');
select is((select vertical::text from public.shops where id = pg_temp.v('shop')), 'watch', 'trade saved');
select is((select currency from public.shops where id = pg_temp.v('shop')), 'USD', 'currency follows the country');
select is((select time_zone from public.shops where id = pg_temp.v('shop')), 'America/Denver', 'time zone saved');
select is((select business_hours ->> 'text' from public.shops where id = pg_temp.v('shop')), 'Mon-Fri 10-6', 'pickup hours saved');
select ok((select setup_completed_at is not null from public.shops where id = pg_temp.v('shop')), 'setup marked finished');
select is((select full_name from public.profiles where user_id = 'd1000000-0000-0000-0000-000000000001'), 'Hana Owner', 'owner name saved');

select is((select count(*)::int from public.statuses where shop_id = pg_temp.v('shop')), 8, 'statuses replaced by the watch set');
select is((select id::text from public.statuses where shop_id = pg_temp.v('shop') and is_final), (select v from t where k = 'final'),
  'the final status is kept (same row)');
select is((select position from public.statuses where shop_id = pg_temp.v('shop') and is_final),
  (select max(position) from public.statuses where shop_id = pg_temp.v('shop')), 'and it is last');
select is((select count(*)::int from public.statuses where shop_id = pg_temp.v('shop') and category = 'ready'), 1, 'one Ready status');
select is((select count(*)::int from public.message_templates m join public.statuses s on s.id = m.status_id
            where m.shop_id = pg_temp.v('shop') and s.category = 'ready'), 2, 'Ready templates point at the new Ready');
select is((select count(*)::int from public.custom_field_definitions where shop_id = pg_temp.v('shop')), 4, 'watch fields added');
select is((select count(*)::int from public.catalog_items where shop_id = pg_temp.v('shop') and name = 'Labor'), 1, 'shared starter item not duplicated');
select ok(exists (select 1 from public.catalog_items where id = pg_temp.v('mine')), 'items the owner added are kept');
select is((select count(*)::int from public.catalog_items where shop_id = pg_temp.v('shop')), 8, 'watch starter items plus the owner''s own');
select is((select count(*)::int from public.catalog_item_tax_rates where shop_id = pg_temp.v('shop')), 8, 'the new tax applies to every item');

select set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.finish_shop_setup(pg_temp.v('shop'), 'Again') $$,
  '22023', null, 'setup can only be finished once');
reset role;

-- ===== The trade is fixed once there are tickets ========================
select set_config('request.jwt.claims', '{"sub":"d2000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop_i', public.create_shop(null, null, 'other', 'CA', null, 'America/Toronto')::text);
insert into t values ('cust', public.save_customer(pg_temp.v('shop_i'), null, 'Ina', '416 555 0123')::text);
insert into t select 'tk', ticket_id::text from public.create_ticket(pg_temp.v('shop_i'), pg_temp.v('cust'), 'Boots');
select throws_ok($$ select public.finish_shop_setup(pg_temp.v('shop_i'), null, null, 'shoe_leather') $$,
  '22023', null, 'the trade cannot change once tickets exist');
select lives_ok($$ select public.finish_shop_setup(pg_temp.v('shop_i'), 'I Repairs', null, 'other') $$,
  'setup still finishes when the trade is unchanged');
reset role;
select is((select count(*)::int from public.statuses where shop_id = pg_temp.v('shop_i')), 4, 'statuses untouched');

-- ===== onboarding_state: never auto-create a shop for invitees or ex-staff =
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.create_invite(pg_temp.v('shop'), 'invited@l.test', 'staff');
reset role;

select set_config('request.jwt.claims', '{"sub":"d5000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.onboarding_state() -> 'pending_invites' -> 0 ->> 'shop_name', 'H Watch Co', 'an invitee sees the shop that invited them');
select is((public.onboarding_state() ->> 'was_member')::boolean, false, 'not yet a former member');
reset role;

select set_config('request.jwt.claims', '{"sub":"d5000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(public.onboarding_state(), '{"pending_invites": [], "was_member": false}'::jsonb,
  'a fresh signup has no invites (other people''s invites stay hidden)');
reset role;

-- Staff who joined by invite and was removed since.
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t select 'tok_staff', token from public.create_invite(pg_temp.v('shop'), 'fresh@l.test', 'staff');
reset role;
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select public.accept_invite((select v from t where k = 'tok_staff'));
reset role;
delete from public.memberships where user_id = 'd5000000-0000-0000-0000-000000000002';
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is((public.onboarding_state() ->> 'was_member')::boolean, true, 'a removed team member is recognised');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$ select public.onboarding_state() $$, '42501', null, 'signed-out callers are refused');
reset role;

select * from finish();
rollback;
