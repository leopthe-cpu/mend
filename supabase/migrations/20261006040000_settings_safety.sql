-- Phase 2 settings (statuses + custom fields) let admins change definitions
-- after tickets exist. Make that safe:
--
-- 1. validate_ticket used to re-check every custom field and the assignee on
--    EVERY ticket update. After an admin deleted a field, made one required,
--    removed a select option, or removed a team member, existing tickets could
--    no longer be updated at all (not even moved on the board). Now only the
--    values that actually change are checked; a new ticket is checked fully.
-- 2. Removing someone from the shop unassigns their tickets there, so no ticket
--    points at a non-member.
-- 3. Statuses can't be deleted while tickets (including deleted ones, which are
--    kept for the audit trail) use them, nor can the final "picked up" status or
--    the last status be deleted. Errors are readable (22023) instead of a raw
--    foreign-key violation.

create or replace function private.validate_ticket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
  v jsonb;
  k text;
  v_full boolean := tg_op = 'INSERT';
begin
  if new.assigned_to is not null
     and (v_full or new.assigned_to is distinct from old.assigned_to)
     and not exists (
       select 1 from public.memberships m where m.shop_id = new.shop_id and m.user_id = new.assigned_to
     ) then
    raise exception 'assignee must be a member of the shop' using errcode = '22023';
  end if;

  if not v_full and new.custom_fields is not distinct from old.custom_fields then
    return new;
  end if;

  -- Keys that are new or changed must be known fields. Values left untouched
  -- (e.g. for a field an admin has since deleted) are kept as they are.
  for k in select jsonb_object_keys(new.custom_fields) loop
    if (v_full or (new.custom_fields -> k) is distinct from (old.custom_fields -> k))
       and not exists (
         select 1 from public.custom_field_definitions c where c.shop_id = new.shop_id and c.id::text = k
       ) then
      raise exception 'unknown custom field' using errcode = '22023';
    end if;
  end loop;

  for d in select * from public.custom_field_definitions c where c.shop_id = new.shop_id loop
    v := new.custom_fields -> d.id::text;
    if not v_full and v is not distinct from (old.custom_fields -> d.id::text) then
      continue;
    end if;
    if v is null or v = 'null'::jsonb or v = '""'::jsonb then
      if d.required then
        raise exception '% is required', d.label using errcode = '22023';
      end if;
      continue;
    end if;
    if d.field_type = 'number' and jsonb_typeof(v) <> 'number' then
      raise exception '% must be a number', d.label using errcode = '22023';
    elsif d.field_type = 'date' and (jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$') then
      raise exception '% must be a date', d.label using errcode = '22023';
    elsif d.field_type = 'select' and not (d.options ? (v #>> '{}')) then
      raise exception '% must be one of the listed options', d.label using errcode = '22023';
    elsif d.field_type = 'text' and (jsonb_typeof(v) <> 'string' or length(v #>> '{}') > 500) then
      raise exception '% must be text (up to 500 characters)', d.label using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$$;

create function private.unassign_removed_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tickets set assigned_to = null
   where shop_id = old.shop_id and assigned_to = old.user_id;
  return old;
end;
$$;
revoke execute on function private.unassign_removed_member() from public, anon, authenticated;

create trigger memberships_unassign_tickets
  after delete on public.memberships
  for each row execute function private.unassign_removed_member();

create function private.guard_status_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Deleting the whole shop cascades here; nothing to protect then.
  if not exists (select 1 from public.shops where id = old.shop_id) then
    return old;
  end if;
  if old.is_final then
    raise exception 'the picked-up status can''t be deleted' using errcode = '22023';
  end if;
  if exists (select 1 from public.tickets t where t.shop_id = old.shop_id and t.status_id = old.id) then
    raise exception 'tickets still use this status. Move them to another status first' using errcode = '22023';
  end if;
  if not exists (select 1 from public.statuses s where s.shop_id = old.shop_id and s.id <> old.id) then
    raise exception 'a shop needs at least one status' using errcode = '22023';
  end if;
  return old;
end;
$$;
revoke execute on function private.guard_status_delete() from public, anon, authenticated;

create trigger statuses_guard_delete
  before delete on public.statuses
  for each row execute function private.guard_status_delete();

-- The final flag is fixed per shop (seeded at onboarding); admins rename it
-- but don't move or clear it (decision 33).
create function private.guard_status_final()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_final is distinct from old.is_final then
    raise exception 'the picked-up status can''t be changed' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_status_final() from public, anon, authenticated;

create trigger statuses_guard_final
  before update on public.statuses
  for each row execute function private.guard_status_final();
