-- Decision 85: lower the passcode reveal cap from 30 to 10 per person per
-- shop per hour. A counter person reveals a few passcodes a day; 10 still
-- covers a busy hour and halves the damage a stolen session can do. The
-- passcode feature itself is behind a client flag (src/lib/features.ts), off
-- for launch; this function stays so saved passcodes can still be revealed.
create or replace function public.reveal_passcode(p_ticket_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tickets;
begin
  select * into t from public.tickets where id = p_ticket_id and deleted_at is null;
  if not found or not private.has_role(t.shop_id, 'staff') then
    raise exception 'ticket not found' using errcode = 'P0002';
  end if;
  if not (private.has_role(t.shop_id, 'admin') or t.assigned_to = (select auth.uid())) then
    raise exception 'only the owner, admins or the assigned staff member can reveal the passcode' using errcode = '42501';
  end if;
  if t.passcode_encrypted is null then
    return null;
  end if;
  if (select count(*) from public.audit_log a
       where a.shop_id = t.shop_id and a.actor_id = (select auth.uid())
         and a.action = 'passcode.revealed' and a.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too many passcodes viewed in the last hour. Try again later' using errcode = '54000';
  end if;
  perform private.audit(t.shop_id, 'passcode.revealed', 'tickets', t.id, null, jsonb_build_object('ticket_number', t.ticket_number));
  perform private.ticket_event(t.shop_id, t.id, 'passcode_revealed');
  return private.pii_decrypt(t.passcode_encrypted);
end;
$$;
