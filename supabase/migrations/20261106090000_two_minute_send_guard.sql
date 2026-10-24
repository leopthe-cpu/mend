-- Two minutes between messages on one ticket (Oz, 24 Oct; decision 137).
-- Right after a ticket was created, its automatic "ticket created" text was
-- still waiting for the once-a-minute sender when the Ready text was queued,
-- so the customer got both at once. queue_message now refuses a new message
-- while the ticket has one created in the last 2 minutes that isn't failed
-- or canceled (a failed one can be retried right away). The automatic
-- "ticket created" message itself is never held back. The app shows the
-- same rule as a countdown on Send; this check also covers two people
-- sending at the same moment. Same signature, so existing grants stay.

create or replace function public.queue_message(
  p_ticket_id uuid,
  p_channel public.message_channel,
  p_body text,
  p_subject text default null,
  p_kind text default 'status'
)
returns table (message_id uuid, scheduled_for timestamptz, quiet_hours boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tickets;
  s public.shops;
  c public.customers;
  v_now timestamptz := now();
  v_at timestamptz;
  v_month_start timestamptz;
  v_id uuid;
begin
  select * into t from public.tickets where id = p_ticket_id and deleted_at is null;
  if not found or not private.has_role(t.shop_id, 'staff') then
    raise exception 'ticket not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from auth.users u where u.id = (select auth.uid()) and u.email_confirmed_at is not null) then
    raise exception 'confirm your email address before messaging customers' using errcode = '42501';
  end if;
  if p_kind not in ('status', 'reminder', 'manual', 'created') then
    raise exception 'unknown message kind' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 1600 then
    raise exception 'write a message (up to 1600 characters)' using errcode = '22023';
  end if;
  if p_channel = 'email' and char_length(btrim(coalesce(p_subject, ''))) not between 1 and 200 then
    raise exception 'add an email subject' using errcode = '22023';
  end if;
  select * into s from public.shops where id = t.shop_id for update;
  select * into c from public.customers where id = t.customer_id;

  if p_channel = 'sms' then
    if c.sms_opted_out then
      raise exception 'this customer has opted out of text messages' using errcode = '42501';
    end if;
    if c.phone_encrypted is null then
      raise exception 'this customer has no mobile number' using errcode = '22023';
    end if;
  else
    if c.email_opted_out then
      raise exception 'this customer has opted out of email' using errcode = '42501';
    end if;
    if c.email_encrypted is null then
      raise exception 'this customer has no email address' using errcode = '22023';
    end if;
  end if;

  if (select count(*) from public.messages m where m.shop_id = s.id and m.created_at > v_now - interval '10 minutes') >= 30 then
    raise exception 'too many messages in the last few minutes. Try again shortly' using errcode = '54000';
  end if;
  if (select count(*) from public.messages m where m.ticket_id = t.id and m.created_at > v_now - interval '1 hour') >= 5 then
    raise exception 'this ticket already had 5 messages in the last hour' using errcode = '54000';
  end if;
  if p_kind <> 'created' and exists (
    select 1 from public.messages m
     where m.ticket_id = t.id
       and m.status not in ('failed', 'canceled')
       and m.created_at > v_now - interval '2 minutes'
  ) then
    raise exception 'this ticket got a message less than 2 minutes ago. Wait a moment before sending another'
      using errcode = '54000';
  end if;
  if p_channel = 'sms' then
    v_month_start := date_trunc('month', v_now at time zone s.time_zone) at time zone s.time_zone;
    if (select count(*) from public.messages m
         where m.shop_id = s.id and m.channel = 'sms' and m.status <> 'canceled' and m.created_at >= v_month_start) >= s.sms_monthly_cap then
      raise exception 'your shop reached its monthly limit of % text messages. Email still works', s.sms_monthly_cap
        using errcode = '54000';
    end if;
  end if;

  v_at := private.next_send_at(v_now, s.time_zone, s.quiet_hours_start, s.quiet_hours_end);
  insert into public.messages (shop_id, ticket_id, customer_id, channel, kind, subject, body, scheduled_for,
                               queued_for_quiet_hours, sent_by)
  values (s.id, t.id, c.id, p_channel, p_kind, case when p_channel = 'email' then btrim(p_subject) end, btrim(p_body),
          v_at, v_at > v_now, (select auth.uid()))
  returning id into v_id;
  perform private.ticket_event(s.id, t.id, 'message', jsonb_build_object(
    'action', 'queued', 'channel', p_channel, 'kind', p_kind, 'message_id', v_id, 'scheduled_for', v_at));
  return query select v_id, v_at, v_at > v_now;
end;
$$;
