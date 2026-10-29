-- Deleting a column can also delete its tickets (Oz, 29 Oct; decision 147).
-- The confirmation asks: move the tickets to another column, or delete them.
-- Deleting uses the same soft delete as one ticket (public.delete_ticket):
-- hidden, passcode removed, audited, on the timeline. Deleted tickets still
-- need a column, so they move to the first remaining one before the column
-- goes. Owner and Admin only, as before.

drop function public.delete_status(uuid, uuid);

create function public.delete_status(
  p_status_id uuid,
  p_move_to uuid default null,
  p_delete_tickets boolean default false
)
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
  if p_delete_tickets then
    for t in select id from public.tickets where status_id = s.id and deleted_at is null loop
      perform public.delete_ticket(t.id);
    end loop;
    -- Where the deleted tickets are kept: the first other column.
    select * into d from public.statuses
     where shop_id = s.shop_id and id <> s.id order by position limit 1;
  elsif exists (select 1 from public.tickets where status_id = s.id) then
    select * into d from public.statuses where id = p_move_to and shop_id = s.shop_id and id <> s.id;
    if not found then
      raise exception 'choose where this column''s tickets go' using errcode = '22023';
    end if;
  end if;
  for t in select id, passcode_encrypted, deleted_at from public.tickets where status_id = s.id loop
    update public.tickets set
      status_id = d.id,
      status_changed_at = case when t.deleted_at is null then now() else status_changed_at end,
      picked_up_at = case when t.deleted_at is null and d.is_final then now() else picked_up_at end,
      passcode_encrypted = case when d.is_final then null else passcode_encrypted end
    where id = t.id;
    if t.deleted_at is null then
      perform private.ticket_event(s.shop_id, t.id, 'status_change',
        jsonb_build_object('from', s.name, 'to', d.name, 'to_category', d.category));
      if d.is_final and t.passcode_encrypted is not null then
        perform private.ticket_event(s.shop_id, t.id, 'passcode_purged');
      end if;
    end if;
  end loop;
  delete from public.statuses where id = s.id;
end;
$$;

revoke execute on function public.delete_status(uuid, uuid, boolean) from public, anon;
grant execute on function public.delete_status(uuid, uuid, boolean) to authenticated;
