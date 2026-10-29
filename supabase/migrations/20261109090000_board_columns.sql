-- Board columns are managed on the board itself (Oz, 29 Oct; decision 145).
--
-- 1. Per-column alerts: "tickets idle here for N days" and "due within N
--    days", each on (N, 1-60) or off (null). Both start at 2 days; a ready
--    column starts without the due alert and the finished column without
--    either (set on insert, so every seed path is covered).
-- 2. Nine column colours instead of five.
-- 3. RPCs for what direct writes can't do safely in one step: add a column
--    after another, reorder all columns, delete a column after moving its
--    tickets, and move the "finished" role to another column (its finished
--    tickets move with it).

alter table public.statuses
  add column idle_alert_days smallint default 2 check (idle_alert_days between 1 and 60),
  add column due_alert_days smallint default 2 check (due_alert_days between 1 and 60);
update public.statuses set due_alert_days = null where category in ('ready', 'closed');
update public.statuses set idle_alert_days = null where category = 'closed';

alter table public.statuses drop constraint statuses_color_check;
alter table public.statuses add constraint statuses_color_check check (color in (
  'received', 'in-progress', 'teal', 'ready', 'waiting', 'orange', 'red', 'pink', 'closed'));

create function private.status_alert_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.category in ('ready', 'closed') then
    new.due_alert_days := null;
  end if;
  if new.category = 'closed' then
    new.idle_alert_days := null;
  end if;
  return new;
end;
$$;
revoke execute on function private.status_alert_defaults() from public, anon, authenticated;
create trigger statuses_alert_defaults
  before insert on public.statuses
  for each row execute function private.status_alert_defaults();

-- The finished flag still can't be changed directly; only
-- public.set_finished_status moves it (it sets this flag for its own
-- transaction).
create or replace function private.guard_status_final()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_final is distinct from old.is_final
     and coalesce(current_setting('mend.moving_finished', true), '') <> 'on' then
    raise exception 'the picked-up status can''t be changed' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- Add a column right after another one (or first, when p_after is null).
create function public.add_status(
  p_shop_id uuid,
  p_after uuid,
  p_name text,
  p_color text,
  p_notify boolean default false,
  p_idle_days smallint default 2,
  p_due_days smallint default 2
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pos integer;
  v_id uuid;
begin
  if not private.has_role(p_shop_id, 'admin') then
    raise exception 'only the owner or an admin can change board columns' using errcode = '42501';
  end if;
  perform 1 from public.statuses where shop_id = p_shop_id for update;
  if p_after is null then
    v_pos := 0;
  else
    select position + 1 into v_pos from public.statuses where id = p_after and shop_id = p_shop_id;
    if not found then
      raise exception 'column not found' using errcode = 'P0002';
    end if;
  end if;
  update public.statuses set position = position + 1 where shop_id = p_shop_id and position >= v_pos;
  insert into public.statuses (shop_id, name, position, category, color, notify_by_default,
                               idle_alert_days, due_alert_days)
  values (p_shop_id, btrim(p_name), v_pos, 'open', p_color, coalesce(p_notify, false),
          p_idle_days, p_due_days)
  returning id into v_id;
  return v_id;
end;
$$;

-- Put every column of a shop in the given order (all of them, once each).
create function public.reorder_statuses(p_shop_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_shop_id, 'admin') then
    raise exception 'only the owner or an admin can change board columns' using errcode = '42501';
  end if;
  perform 1 from public.statuses where shop_id = p_shop_id for update;
  if cardinality(p_ids) is distinct from (select count(*) from public.statuses where shop_id = p_shop_id)
     or (select count(distinct x) from unnest(p_ids) x) <> cardinality(p_ids)
     or exists (select 1 from unnest(p_ids) x
                 where not exists (select 1 from public.statuses s where s.id = x and s.shop_id = p_shop_id)) then
    raise exception 'the board changed. Reload and try again' using errcode = '22023';
  end if;
  update public.statuses s set position = o.n - 1
    from unnest(p_ids) with ordinality o(id, n)
   where s.id = o.id and s.position is distinct from o.n - 1;
end;
$$;

-- Delete a column; its tickets move to p_move_to first.
create function public.delete_status(p_status_id uuid, p_move_to uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.statuses;
  d public.statuses;
  t record;
begin
  select * into s from public.statuses where id = p_status_id;
  if not found or not private.has_role(s.shop_id, 'admin') then
    raise exception 'column not found' using errcode = 'P0002';
  end if;
  if s.is_final then
    raise exception 'make another column the finished one before deleting this one' using errcode = '22023';
  end if;
  if exists (select 1 from public.tickets where status_id = s.id) then
    select * into d from public.statuses where id = p_move_to and shop_id = s.shop_id and id <> s.id;
    if not found then
      raise exception 'choose where this column''s tickets go' using errcode = '22023';
    end if;
    for t in select id, passcode_encrypted from public.tickets where status_id = s.id loop
      update public.tickets set
        status_id = d.id,
        status_changed_at = now(),
        picked_up_at = case when d.is_final then now() else null end,
        passcode_encrypted = case when d.is_final then null else passcode_encrypted end
      where id = t.id;
      perform private.ticket_event(s.shop_id, t.id, 'status_change',
        jsonb_build_object('from', s.name, 'to', d.name, 'to_category', d.category));
      if d.is_final and t.passcode_encrypted is not null then
        perform private.ticket_event(s.shop_id, t.id, 'passcode_purged');
      end if;
    end loop;
  end if;
  delete from public.statuses where id = s.id;
end;
$$;

-- Make a column the finished one. The old finished column becomes a normal
-- column and its finished tickets move here; tickets already here are
-- finished now (picked up, passcode deleted).
create function public.set_finished_status(p_status_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.statuses;
  o public.statuses;
  t record;
begin
  select * into s from public.statuses where id = p_status_id;
  if not found or not private.has_role(s.shop_id, 'admin') then
    raise exception 'column not found' using errcode = 'P0002';
  end if;
  if s.is_final then
    return;
  end if;
  perform 1 from public.statuses where shop_id = s.shop_id for update;
  select * into o from public.statuses where shop_id = s.shop_id and is_final;
  perform set_config('mend.moving_finished', 'on', true);
  update public.statuses set is_final = false, category = 'open', idle_alert_days = 2, due_alert_days = 2
   where id = o.id;
  for t in select id, passcode_encrypted from public.tickets where status_id = s.id loop
    update public.tickets set picked_up_at = coalesce(picked_up_at, now()), passcode_encrypted = null
     where id = t.id;
    if t.passcode_encrypted is not null then
      perform private.ticket_event(s.shop_id, t.id, 'passcode_purged');
    end if;
  end loop;
  for t in select id from public.tickets where status_id = o.id loop
    update public.tickets set status_id = s.id where id = t.id;
    perform private.ticket_event(s.shop_id, t.id, 'status_change',
      jsonb_build_object('from', o.name, 'to', s.name, 'to_category', 'closed'));
  end loop;
  update public.statuses set is_final = true, category = 'closed', idle_alert_days = null, due_alert_days = null
   where id = s.id;
  perform set_config('mend.moving_finished', 'off', true);
end;
$$;

revoke execute on function public.add_status(uuid, uuid, text, text, boolean, smallint, smallint) from public, anon;
revoke execute on function public.reorder_statuses(uuid, uuid[]) from public, anon;
revoke execute on function public.delete_status(uuid, uuid) from public, anon;
revoke execute on function public.set_finished_status(uuid) from public, anon;
grant execute on function public.add_status(uuid, uuid, text, text, boolean, smallint, smallint) to authenticated;
grant execute on function public.reorder_statuses(uuid, uuid[]) to authenticated;
grant execute on function public.delete_status(uuid, uuid) to authenticated;
grant execute on function public.set_finished_status(uuid) to authenticated;
