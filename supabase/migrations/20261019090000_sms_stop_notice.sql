-- Launch plan L1c (docs/legal-compliance.md §4.1, §7 item 3): Twilio's
-- Messaging Policy wants opt-out instructions in the first text a person
-- gets, and CASL needs an unsubscribe mechanism. Every text Mend queues goes
-- through public.messages, so a BEFORE INSERT trigger covers all paths
-- (queue_message from the app and the automatic "created" message) without
-- copying queue_message again.
--
-- Rule: append " Reply STOP to opt out." to a text unless this customer has
-- already been sent (or is about to be sent) a text from this shop that
-- mentions STOP. Canceled and failed texts don't count: the customer never
-- received them. A body that already mentions STOP is left alone, and so is a
-- body too long to take the notice (the next text then carries it).

create function private.sms_stop_notice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notice constant text := 'Reply STOP to opt out.';
begin
  if new.channel <> 'sms' or new.body ~* '\mstop\M' then
    return new;
  end if;
  if exists (
    select 1 from public.messages m
     where m.shop_id = new.shop_id and m.customer_id = new.customer_id and m.channel = 'sms'
       and m.status not in ('canceled', 'failed') and m.body ~* '\mstop\M'
  ) then
    return new;
  end if;
  if char_length(btrim(new.body)) + 1 + char_length(v_notice) <= 1600 then
    new.body := btrim(new.body) || ' ' || v_notice;
  end if;
  return new;
end;
$$;

revoke execute on function private.sms_stop_notice() from public, anon, authenticated;

create trigger messages_sms_stop_notice
  before insert on public.messages
  for each row execute function private.sms_stop_notice();
