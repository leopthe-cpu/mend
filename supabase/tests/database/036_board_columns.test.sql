-- Decision 145: columns managed on the board (add, reorder, delete with a
-- move, the finished role moving with its tickets) and per-column alerts.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('ae000000-0000-0000-0000-000000000001', 'owner@cols.test', now(), '{}'),
  ('ae000000-0000-0000-0000-000000000002', 'other@cols.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated;
create function pg_temp.names() returns text language sql security definer as $$
  select string_agg(name, ',' order by position) from public.statuses where shop_id = pg_temp.v('shop') $$;
grant execute on function pg_temp.names() to authenticated;

select set_config('request.jwt.claims', '{"sub":"ae000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('Cols Shop', null, 'other', 'CA', null, 'America/Toronto')::text);
insert into t values ('cust', public.save_customer(pg_temp.v('shop'), null, 'Ana Cols', '4165550800', null)::text);
insert into t select 'tk', ticket_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'), 'Coat');
insert into t select 'tk2', ticket_id::text from public.create_ticket_full(pg_temp.v('shop'), pg_temp.v('cust'), 'Hem');
reset role;
insert into t select 'first', id::text from public.statuses where shop_id = pg_temp.v('shop') order by position limit 1;
insert into t select 'ready', id::text from public.statuses where shop_id = pg_temp.v('shop') and category = 'ready' limit 1;
insert into t select 'final', id::text from public.statuses where shop_id = pg_temp.v('shop') and is_final;
update public.tickets set passcode_encrypted = 'x'::bytea where id = pg_temp.v('tk2');

-- ===== Alert defaults =====================================================
select is((select idle_alert_days from public.statuses where id = pg_temp.v('first')), 2::smallint, 'open columns alert after 2 idle days');
select is((select due_alert_days from public.statuses where id = pg_temp.v('first')), 2::smallint, 'and 2 days before due');
select is((select due_alert_days from public.statuses where id = pg_temp.v('ready')), null, 'ready columns have no due alert');
select is((select idle_alert_days from public.statuses where id = pg_temp.v('final')), null, 'the finished column has no alerts');

-- ===== Add after a column, reorder =======================================
set local role authenticated;
insert into t values ('qc', public.add_status(pg_temp.v('shop'), pg_temp.v('first'), ' QC ', 'teal')::text);
reset role;
select is(split_part(pg_temp.names(), ',', 2), 'QC', 'the new column sits right after the one it was added to');
select is((select category::text || color from public.statuses where id = pg_temp.v('qc')), 'openteal', 'new columns are open, in the chosen colour');
set local role authenticated;
select lives_ok($$ select public.reorder_statuses(pg_temp.v('shop'),
  (select array_agg(id order by case when id = pg_temp.v('qc') then -1 else position end)
     from public.statuses where shop_id = pg_temp.v('shop'))) $$, 'reorder all columns');
reset role;
select is(split_part(pg_temp.names(), ',', 1), 'QC', 'QC is first now');
set local role authenticated;
select throws_ok($$ select public.reorder_statuses(pg_temp.v('shop'), array[pg_temp.v('qc')]) $$, '22023', null,
  'a partial order is refused');
reset role;

-- ===== Delete with a move ================================================
update public.tickets set status_id = pg_temp.v('qc') where id = pg_temp.v('tk');
set local role authenticated;
select throws_ok($$ select public.delete_status(pg_temp.v('qc')) $$, '22023',
  'choose where this column''s tickets go', 'a column with tickets needs a destination');
select lives_ok($$ select public.delete_status(pg_temp.v('qc'), pg_temp.v('ready')) $$, 'delete, moving its tickets');
reset role;
select is((select status_id from public.tickets where id = pg_temp.v('tk')), pg_temp.v('ready'), 'the ticket moved');
select ok(not exists (select 1 from public.statuses where id = pg_temp.v('qc')), 'the column is gone');
select ok(exists (select 1 from public.ticket_events where ticket_id = pg_temp.v('tk') and type = 'status_change'), 'the move is on the timeline');
set local role authenticated;
select throws_ok($$ select public.delete_status(pg_temp.v('final'), pg_temp.v('ready')) $$, '22023', null,
  'the finished column can''t be deleted');

-- ===== Moving the finished role ==========================================
reset role;
update public.tickets set status_id = pg_temp.v('final'), picked_up_at = now(), passcode_encrypted = null where id = pg_temp.v('tk');
set local role authenticated;
insert into t values ('done', public.add_status(pg_temp.v('shop'), pg_temp.v('final'), 'Archived', 'closed')::text);
select throws_ok($$ update public.statuses set is_final = true where id = pg_temp.v('done') $$, '22023', null,
  'the finished flag can''t be set directly');
select lives_ok($$ select public.set_finished_status(pg_temp.v('done')) $$, 'move the finished role');
reset role;
select ok((select is_final and category = 'closed' from public.statuses where id = pg_temp.v('done')), 'the new column is finished');
select ok((select not is_final and category = 'open' from public.statuses where id = pg_temp.v('final')), 'the old one is a normal column');
select is((select status_id from public.tickets where id = pg_temp.v('tk')), pg_temp.v('done'), 'finished tickets moved with it');
-- Making a column with live tickets finished finishes them.
update public.tickets set status_id = pg_temp.v('final') where id = pg_temp.v('tk2');
set local role authenticated;
select lives_ok($$ select public.set_finished_status(pg_temp.v('final')) $$, 'move it back');
reset role;
select ok((select picked_up_at is not null and passcode_encrypted is null from public.tickets where id = pg_temp.v('tk2')),
  'tickets already there are finished, passcode deleted');
select is((select count(*)::int from public.statuses where shop_id = pg_temp.v('shop') and is_final), 1, 'still exactly one finished column');

-- ===== Only the shop's admins =============================================
select set_config('request.jwt.claims', '{"sub":"ae000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.add_status(pg_temp.v('shop'), null, 'X', 'teal') $$, '42501', null, 'outsiders can''t add');
select throws_ok($$ select public.delete_status(pg_temp.v('ready'), pg_temp.v('first')) $$, 'P0002', null, 'or delete');
select throws_ok($$ select public.set_finished_status(pg_temp.v('ready')) $$, 'P0002', null, 'or move the finished role');
select throws_ok($$ select public.reorder_statuses(pg_temp.v('shop'), array[]::uuid[]) $$, '42501', null, 'or reorder');
reset role;

select * from finish();
rollback;
