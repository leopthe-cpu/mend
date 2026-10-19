-- Main search by item, description and date (decision 102).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('ae000000-0000-0000-0000-000000000001', 'owner@search.test', now(), '{}'),
  ('ae000000-0000-0000-0000-000000000002', 'other@search.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated;
create function pg_temp.hits(q text) returns setof text language sql as $$
  select kind || ':' || label from public.search_shop(pg_temp.v('shop'), q) $$;
grant execute on function pg_temp.hits(text) to authenticated;

select set_config('request.jwt.claims', '{"sub":"ae000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('Search Shop', null, 'other', 'CA', null, 'America/Toronto')::text);
insert into t values ('ann', public.save_customer(pg_temp.v('shop'), null, 'Ann Lee', '416 555 0151')::text);
insert into t values ('bob', public.save_customer(pg_temp.v('shop'), null, 'Bob Roy', '416 555 0152')::text);
insert into t select 'coat', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('ann'), 'Wool coat',
  p_issue_description => 'Replace the lining', p_promised_date => '2026-11-02');
insert into t select 'jeans', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('bob'), 'Jeans',
  p_issue_description => 'Hem 2 cm', p_promised_date => '2026-11-03');
insert into t select 'gone', ticket_id::text from public.create_ticket(pg_temp.v('shop'), pg_temp.v('bob'), 'Old coat');
select public.delete_ticket(pg_temp.v('gone'));

select results_eq($$ select * from pg_temp.hits('coat') $$,
  $$ values ('ticket:#1001 · Wool coat'::text) $$, 'item name matches; deleted tickets never show');
select results_eq($$ select * from pg_temp.hits('LINING') $$,
  $$ values ('ticket:#1001 · Wool coat'::text) $$, 'what needs doing matches, any case');
select results_eq($$ select * from pg_temp.hits('ann') $$,
  $$ values ('customer:Ann Lee'::text), ('ticket:#1001 · Wool coat'::text) $$,
  'a customer name finds the customer, then their tickets');
select results_eq($$ select * from pg_temp.hits('2026-11-03') $$,
  $$ values ('ticket:#1002 · Jeans'::text) $$, 'a date finds tickets ready by that day');
select is((select sublabel from public.search_shop(pg_temp.v('shop'), '2026-11-03')),
  'Bob Roy · Ready by this day', 'says why the ticket matched');
select ok((select count(*) from public.search_shop(pg_temp.v('shop'),
  ((now() at time zone 'America/Toronto')::date)::text)) = 2,
  'a date finds tickets dropped off that day (shop time zone), not deleted ones');
select is_empty($$ select * from pg_temp.hits('2026-02-30') $$, 'an impossible date finds nothing and does not fail');
select is_empty($$ select * from pg_temp.hits('%%') $$, 'pattern characters alone match nothing');
reset role;

-- Another shop's member sees nothing.
select set_config('request.jwt.claims', '{"sub":"ae000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is_empty($$ select * from pg_temp.hits('coat') $$, 'other shops cannot search this one');
reset role;

select * from finish();
rollback;
