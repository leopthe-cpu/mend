-- One customer's data for a privacy access request (decision 87).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('ad000000-0000-0000-0000-000000000001', 'owner@cx.test', now(), '{}'),
  ('ad000000-0000-0000-0000-000000000002', 'staff@cx.test', now(), '{}'),
  ('ad000000-0000-0000-0000-000000000003', 'other@cx.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated;

select set_config('request.jwt.claims', '{"sub":"ad000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('Export Shop', null, 'other', 'CA', null, 'America/Toronto')::text);
insert into t values ('ann', public.save_customer(pg_temp.v('shop'), null, 'Ann Lee', '416 555 0141', 'ann@example.com')::text);
insert into t values ('bob', public.save_customer(pg_temp.v('shop'), null, 'Bob Roy', '416 555 0142')::text);
insert into t select 'tk_ann', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('ann'), 'Wool coat',
  p_passcode => '1234');
insert into t select 'tk_bob', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('bob'), 'Jeans');
select public.add_ticket_note(pg_temp.v('tk_ann'), 'Prefers a call');
insert into t values ('out', public.export_customer(pg_temp.v('ann'))::text);
reset role;
insert into public.memberships (shop_id, user_id, role)
  values (pg_temp.v('shop'), 'ad000000-0000-0000-0000-000000000002', 'staff');

select is((select v::jsonb -> 'customer' ->> 'name' from t where k = 'out'), 'Ann Lee', 'the customer is included');
select is((select v::jsonb -> 'customer' ->> 'email' from t where k = 'out'), 'ann@example.com', 'contact details are decrypted');
select ok((select not (v::jsonb -> 'customer' ? 'phone_hash') from t where k = 'out'), 'no blind-index hashes');
select is((select jsonb_array_length(v::jsonb -> 'tickets') from t where k = 'out'), 1, 'only this customer''s tickets');
select is((select v::jsonb -> 'tickets' -> 0 ->> 'item_name' from t where k = 'out'), 'Wool coat', 'her ticket');
select ok((select not (v::jsonb -> 'tickets' -> 0 ? 'passcode_encrypted') from t where k = 'out'), 'no passcode');
select ok((select (v::jsonb -> 'tickets' -> 0 ->> 'has_passcode')::boolean from t where k = 'out'), 'says a passcode exists');
select ok((select jsonb_array_length(v::jsonb -> 'ticket_events') from t where k = 'out') >= 1, 'timeline included');
select ok(exists (select 1 from public.audit_log where action = 'customer.exported' and entity_id = pg_temp.v('ann')), 'the export is audited');

select set_config('request.jwt.claims', '{"sub":"ad000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.export_customer(pg_temp.v('ann')) $$, '42501', null, 'staff cannot export');
reset role;
select set_config('request.jwt.claims', '{"sub":"ad000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.export_customer(pg_temp.v('ann')) $$, 'P0002', null, 'another shop cannot see the customer');
reset role;

select * from finish();
rollback;
