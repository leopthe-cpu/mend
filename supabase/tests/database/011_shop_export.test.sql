-- Phase 5 data export (decision 56): Owner only, fresh password, everything
-- the shop owns with contacts decrypted, no passcodes or hashes, audited,
-- never another shop's data.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('e1000000-0000-0000-0000-000000000001', 'owner@m.test', now(), '{}'),
  ('e1000000-0000-0000-0000-000000000002', 'admin@m.test', now(), '{}'),
  ('e2000000-0000-0000-0000-000000000001', 'owner@n.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated;
-- Claims for a session that signed in with a password just now (or long ago).
create function pg_temp.claims(p_sub text, p_age_seconds int) returns text language sql as $$
  select json_build_object('sub', p_sub, 'role', 'authenticated', 'aal', 'aal1',
    'amr', json_build_array(json_build_object('method', 'password',
      'timestamp', extract(epoch from now())::bigint - p_age_seconds)))::text $$;

select set_config('request.jwt.claims', pg_temp.claims('e1000000-0000-0000-0000-000000000001', 0), true);
set local role authenticated;
insert into t values ('shop', public.create_shop('M Repairs', null, 'watch', 'CA', null, 'America/Toronto')::text);
insert into t values ('cust', public.save_customer(pg_temp.v('shop'), null, 'Mina', '416 555 0111', 'mina@example.com')::text);
insert into t select 'tk', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('cust'), 'Pocket watch',
  null, null, null, null, '{}'::jsonb, '1234');
reset role;
insert into public.memberships (shop_id, user_id, role) values (pg_temp.v('shop'), 'e1000000-0000-0000-0000-000000000002', 'admin');

select set_config('request.jwt.claims', pg_temp.claims('e2000000-0000-0000-0000-000000000001', 0), true);
set local role authenticated;
insert into t values ('other', public.create_shop('N Repairs', null, 'other', 'CA', null, 'America/Toronto')::text);
insert into t values ('other_cust', public.save_customer(pg_temp.v('other'), null, 'Noor', '416 555 0222')::text);
select throws_ok($$ select public.export_shop(pg_temp.v('shop')) $$, '42501', null, 'another shop''s owner cannot export it');
reset role;

select set_config('request.jwt.claims', pg_temp.claims('e1000000-0000-0000-0000-000000000002', 0), true);
set local role authenticated;
select throws_ok($$ select public.export_shop(pg_temp.v('shop')) $$, '42501', null, 'an admin cannot export');
reset role;

select set_config('request.jwt.claims', pg_temp.claims('e1000000-0000-0000-0000-000000000001', 3600), true);
set local role authenticated;
select throws_ok($$ select public.export_shop(pg_temp.v('shop')) $$, '42501', null, 'the owner must have re-entered the password recently');
reset role;

select set_config('request.jwt.claims', pg_temp.claims('e1000000-0000-0000-0000-000000000001', 0), true);
set local role authenticated;
insert into t values ('export', public.export_shop(pg_temp.v('shop'))::text);
reset role;

create function pg_temp.x() returns jsonb language sql as $$ select v::jsonb from t where k = 'export' $$;
select is(pg_temp.x() ->> 'format', 'mend-export', 'export is labelled');
select is(pg_temp.x() -> 'shop' ->> 'name', 'M Repairs', 'shop settings included');
select is(jsonb_array_length(pg_temp.x() -> 'customers'), 1, 'only this shop''s customers');
select is(pg_temp.x() -> 'customers' -> 0 ->> 'phone', '+14165550111', 'phone decrypted');
select is(pg_temp.x() -> 'customers' -> 0 ->> 'email', 'mina@example.com', 'email decrypted');
select ok(not (pg_temp.x() -> 'customers' -> 0 ? 'phone_hash') and not (pg_temp.x() -> 'customers' -> 0 ? 'phone_encrypted'),
  'no blind-index hashes or ciphertext');
select is(jsonb_array_length(pg_temp.x() -> 'tickets'), 1, 'tickets included');
select ok(not (pg_temp.x() -> 'tickets' -> 0 ? 'passcode_encrypted'), 'device passcodes are left out');
select is((pg_temp.x() -> 'tickets' -> 0 ->> 'has_passcode')::boolean, true, 'but the export says a passcode exists');
select is(jsonb_array_length(pg_temp.x() -> 'team'), 2, 'team listed');
select is(jsonb_array_length(pg_temp.x() -> 'statuses'), 8, 'statuses included');
select ok(jsonb_array_length(pg_temp.x() -> 'catalog_items') > 0, 'catalog included');
select ok(pg_temp.x() ? 'audit_log' and pg_temp.x() ? 'messages' and pg_temp.x() ? 'payments' and pg_temp.x() ? 'invoices',
  'money, messages and audit log sections present');
select ok(position('Noor' in pg_temp.x()::text) = 0, 'nothing from the other shop');
select is((select count(*)::int from public.audit_log where shop_id = pg_temp.v('shop') and action = 'shop.exported'), 1,
  'the export is audited');

select * from finish();
rollback;
