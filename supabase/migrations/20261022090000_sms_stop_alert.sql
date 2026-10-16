-- Tell the shop when a customer stops texts (decision 77): when a customer
-- replies STOP (or staff turn texts off), record when and how, and put an
-- entry on the timeline of the customer's open tickets, so the shop knows to
-- call or email instead. A STOP to Mend's shared number can't tell which shop
-- it was meant for, so record_sms_opt_out already turns texts off for that
-- phone at every shop that has it; each of those shops is told.

alter table public.customers
  add column sms_opted_out_at timestamptz,
  add column sms_opt_out_source text check (sms_opt_out_source in ('stop', 'staff'));
grant select (sms_opted_out_at, sms_opt_out_source) on public.customers to authenticated;

-- BEFORE: stamp when and how. The STOP path (record_sms_opt_out) runs from the
-- Twilio webhook with no signed-in user; set_customer_opt_out always has one.
create function private.customer_sms_opt_out_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sms_opted_out and not old.sms_opted_out then
    new.sms_opted_out_at := now();
    new.sms_opt_out_source := case when (select auth.uid()) is null then 'stop' else 'staff' end;
  elsif not new.sms_opted_out and old.sms_opted_out then
    new.sms_opted_out_at := null;
    new.sms_opt_out_source := null;
  end if;
  return new;
end;
$$;

-- AFTER: one timeline entry per open ticket (not deleted, not picked up, not
-- in a final status).
create function private.customer_sms_opt_out_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if new.sms_opted_out and not old.sms_opted_out then
    for r in
      select t.id from public.tickets t join public.statuses s on s.id = t.status_id
       where t.customer_id = new.id and t.deleted_at is null and t.picked_up_at is null and not s.is_final
    loop
      perform private.ticket_event(new.shop_id, r.id, 'message',
        jsonb_build_object('action', 'sms_opt_out', 'source', new.sms_opt_out_source));
    end loop;
  end if;
  return new;
end;
$$;

revoke execute on function private.customer_sms_opt_out_stamp(), private.customer_sms_opt_out_events()
  from public, anon, authenticated;

create trigger customers_sms_opt_out_stamp
  before update of sms_opted_out on public.customers
  for each row execute function private.customer_sms_opt_out_stamp();
create trigger customers_sms_opt_out_events
  after update of sms_opted_out on public.customers
  for each row execute function private.customer_sms_opt_out_events();
