-- Editing statuses/custom fields/team after tickets exist must not freeze
-- existing tickets (migration 20261006040000_settings_safety.sql).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('c1000000-0000-0000-0000-000000000001', 'owner@c.test', now(), '{}'),
  ('c1000000-0000-0000-0000-000000000002', 'staff@c.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;

select set_config('request.jwt.claims', '{"sub":"c1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('C Repairs', null, 'electronics', 'CA', null, 'America/Toronto')::text);
reset role;
insert into public.memberships (shop_id, user_id, role) values
  ((select v::uuid from t where k = 'shop'), 'c1000000-0000-0000-0000-000000000002', 'staff');

set local role authenticated;
with x as (insert into public.custom_field_definitions (shop_id, label, field_type, position)
  values ((select v::uuid from t where k = 'shop'), 'IMEI', 'text', 1) returning id)
insert into t select 'f_imei', id::text from x;
with x as (insert into public.custom_field_definitions (shop_id, label, field_type, options, position)
  values ((select v::uuid from t where k = 'shop'), 'Kind', 'select', '["Phone","Tablet"]', 2) returning id)
insert into t select 'f_kind', id::text from x;
insert into t values ('cust', public.save_customer((select v::uuid from t where k = 'shop'), null, 'Ann', '4165550100')::text);
insert into t select 'tk', ticket_id::text from public.create_ticket((select v::uuid from t where k = 'shop'), (select v::uuid from t where k = 'cust'),
  'Phone', null, null, null, 'c1000000-0000-0000-0000-000000000002',
  jsonb_build_object((select v from t where k = 'f_imei'), 'abc', (select v from t where k = 'f_kind'), 'Tablet'), null, true);
insert into t select 's1', id::text from public.statuses where shop_id = (select v::uuid from t where k = 'shop') order by position limit 1;
insert into t select 's2', id::text from public.statuses where shop_id = (select v::uuid from t where k = 'shop') and not is_final order by position offset 1 limit 1;

-- Admin changes definitions after the ticket exists.
update public.custom_field_definitions set options = '["Phone"]' where id = (select v::uuid from t where k = 'f_kind');
insert into public.custom_field_definitions (shop_id, label, field_type, position, required)
  values ((select v::uuid from t where k = 'shop'), 'Color', 'text', 3, true);
delete from public.custom_field_definitions where id = (select v::uuid from t where k = 'f_imei');

select lives_ok($$ select public.set_ticket_status((select v::uuid from t where k = 'tk'), (select v::uuid from t where k = 's2')) $$,
  'ticket still moves after a field is deleted, made required, or loses an option');
select lives_ok($$ update public.tickets set item_name = 'Phone 2' where id = (select v::uuid from t where k = 'tk') $$,
  'ticket details still editable');
select throws_ok($$ update public.tickets set custom_fields = custom_fields || jsonb_build_object((select v from t where k = 'f_kind'), 'Laptop')
  where id = (select v::uuid from t where k = 'tk') $$, '22023', null, 'a changed value is still validated');
select throws_ok($$ update public.tickets set custom_fields = custom_fields || '{"00000000-0000-0000-0000-000000000000": "x"}'
  where id = (select v::uuid from t where k = 'tk') $$, '22023', null, 'a new unknown field is still rejected');
select throws_ok($$ select public.create_ticket((select v::uuid from t where k = 'shop'), (select v::uuid from t where k = 'cust'), 'Tablet') $$,
  '22023', 'Color is required', 'new tickets get full validation');

-- Statuses.
select throws_ok($$ delete from public.statuses where id = (select v::uuid from t where k = 's2') $$,
  '22023', null, 'a status in use cannot be deleted');
select throws_ok($$ delete from public.statuses where shop_id = (select v::uuid from t where k = 'shop') and is_final $$,
  '22023', null, 'the final status cannot be deleted');
select throws_ok($$ update public.statuses set is_final = false where shop_id = (select v::uuid from t where k = 'shop') and is_final $$,
  '22023', null, 'the final flag cannot be moved or cleared');
select lives_ok($$ delete from public.statuses where id = (select v::uuid from t where k = 's1') $$,
  'an unused status can be deleted');
reset role;

-- Staff can't edit settings.
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
update public.statuses set name = 'X' where shop_id = (select v::uuid from t where k = 'shop');
reset role;
select is((select count(*)::int from public.statuses where name = 'X'), 0, 'staff cannot rename statuses');
set local role authenticated;
reset role;

-- Removing a member unassigns their tickets.
delete from public.memberships where user_id = 'c1000000-0000-0000-0000-000000000002';
select is((select assigned_to from public.tickets where id = (select v::uuid from t where k = 'tk')), null, 'removed member is unassigned');

-- Deleting the whole shop still cascades through the status guard.
delete from public.ticket_events where shop_id = (select v::uuid from t where k = 'shop');
select lives_ok($$ delete from public.shops where id = (select v::uuid from t where k = 'shop') $$, 'shop deletion still cascades');

select * from finish();
rollback;
