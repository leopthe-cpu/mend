-- Deleting a shop (decision 58): Owner only, fresh password, typed name, no
-- files left; then every row of the shop is gone, other shops untouched,
-- members keep their accounts.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('d7000000-0000-0000-0000-000000000001', 'owner@r.test', now(), '{}'),
  ('d7000000-0000-0000-0000-000000000002', 'admin@r.test', now(), '{}'),
  ('d8000000-0000-0000-0000-000000000001', 'owner@s.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated;
create function pg_temp.claims(p_sub text, p_age_seconds int) returns text language sql as $$
  select json_build_object('sub', p_sub, 'role', 'authenticated', 'aal', 'aal1',
    'amr', json_build_array(json_build_object('method', 'password',
      'timestamp', extract(epoch from now())::bigint - p_age_seconds)))::text $$;

-- Shop R with a customer, ticket, estimate line, payment and a photo file.
select set_config('request.jwt.claims', pg_temp.claims('d7000000-0000-0000-0000-000000000001', 0), true);
set local role authenticated;
insert into t values ('shop', public.create_shop('R Cobbler', null, 'shoe_leather', 'CA', null, 'America/Toronto',
  null, null, null, '{}', '[{"name":"HST","rate":13}]')::text);
insert into t values ('cust', public.save_customer(pg_temp.v('shop'), null, 'Rae', '416 555 0177')::text);
insert into t select 'tk', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('cust'), 'Boots');
select public.record_payment(pg_temp.v('tk'), 'deposit', 'cash', 2000, current_date, null);
insert into storage.objects (bucket_id, name, owner_id)
  values ('ticket-photos', pg_temp.v('shop') || '/' || pg_temp.v('tk') || '/front.jpg', 'd7000000-0000-0000-0000-000000000001');
reset role;
insert into public.memberships (shop_id, user_id, role) values (pg_temp.v('shop'), 'd7000000-0000-0000-0000-000000000002', 'admin');

select set_config('request.jwt.claims', pg_temp.claims('d8000000-0000-0000-0000-000000000001', 0), true);
set local role authenticated;
insert into t values ('other', public.create_shop('S Watches', null, 'watch', 'CA', null, 'America/Toronto')::text);
select throws_ok($$ select public.delete_shop(pg_temp.v('shop'), 'R Cobbler') $$, '42501', null, 'another shop''s owner cannot delete it');
reset role;

select set_config('request.jwt.claims', pg_temp.claims('d7000000-0000-0000-0000-000000000002', 0), true);
set local role authenticated;
select throws_ok($$ select public.delete_shop(pg_temp.v('shop'), 'R Cobbler') $$, '42501', null, 'an admin cannot delete the shop');
reset role;

select set_config('request.jwt.claims', pg_temp.claims('d7000000-0000-0000-0000-000000000001', 3600), true);
set local role authenticated;
select throws_ok($$ select public.delete_shop(pg_temp.v('shop'), 'R Cobbler') $$, '42501', null, 'needs a fresh password');
reset role;

select set_config('request.jwt.claims', pg_temp.claims('d7000000-0000-0000-0000-000000000001', 0), true);
set local role authenticated;
select throws_ok($$ select public.delete_shop(pg_temp.v('shop'), 'R Cobble') $$, '22023', null, 'the name must match');
select throws_ok($$ select public.delete_shop(pg_temp.v('shop'), 'R Cobbler') $$, '22023', null, 'refused while photo files remain');
reset role;
select ok(exists (select 1 from public.shops where id = pg_temp.v('shop')), 'nothing deleted by refused attempts');

-- The app removes files through the Storage API; simulated here with the
-- setting Storage's own delete guard checks (storage.protect_delete).
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'ticket-photos' and name like pg_temp.v('shop') || '/%';

select set_config('request.jwt.claims', pg_temp.claims('d7000000-0000-0000-0000-000000000001', 0), true);
set local role authenticated;
select lives_ok($$ select public.delete_shop(pg_temp.v('shop'), '  r cobbler ') $$, 'owner deletes the shop (name check ignores case and spaces)');
reset role;

select is((select count(*)::int from public.shops where id = pg_temp.v('shop')), 0, 'shop gone');
select is(
  (select sum(n)::int from (
     select count(*) n from public.memberships where shop_id = pg_temp.v('shop') union all
     select count(*) from public.customers where shop_id = pg_temp.v('shop') union all
     select count(*) from public.tickets where shop_id = pg_temp.v('shop') union all
     select count(*) from public.ticket_events where shop_id = pg_temp.v('shop') union all
     select count(*) from public.statuses where shop_id = pg_temp.v('shop') union all
     select count(*) from public.catalog_items where shop_id = pg_temp.v('shop') union all
     select count(*) from public.tax_rates where shop_id = pg_temp.v('shop') union all
     select count(*) from public.estimates where shop_id = pg_temp.v('shop') union all
     select count(*) from public.payments where shop_id = pg_temp.v('shop') union all
     select count(*) from public.messages where shop_id = pg_temp.v('shop') union all
     select count(*) from public.message_templates where shop_id = pg_temp.v('shop') union all
     select count(*) from public.audit_log where shop_id = pg_temp.v('shop')) x),
  0, 'every row of the shop is gone');
select is((select count(*)::int from auth.users where id in ('d7000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-000000000002')),
  2, 'people keep their accounts');
select ok(exists (select 1 from public.shops where id = pg_temp.v('other'))
          and exists (select 1 from public.statuses where shop_id = pg_temp.v('other')), 'other shops untouched');

select * from finish();
rollback;
