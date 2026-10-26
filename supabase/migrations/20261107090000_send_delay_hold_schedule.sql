-- Sending: a 20-second wait, a hold when the ticket moves, and a schedule
-- instead of a refusal (Oz, 26 Oct; decision 138, replaces 137's refusal).
--
-- * Every message waits 20 seconds before it can go out, so it can be undone
--   and, if the ticket's status changes meanwhile, held.
-- * set_ticket_status holds the ticket's messages that haven't gone out
--   (held_at). The app asks the person who moved it: Send (release) or Cancel.
--   Without an answer a held message goes out a minute later.
-- * 2 minutes between messages on one ticket: a new message is scheduled for
--   2 minutes after the previous one instead of being refused. Only one may
--   wait behind another (after_cooldown); a third is refused.
-- * status_id records which status a status update was about, so the app can
--   say "already sent" before a repeat; find_repeat_message also matches the
--   same text.
-- * The sender now runs every 10 seconds (was every minute), so a message
--   goes out within about 10 seconds of its time. pg_cron interval schedules
--   ('[1-59] seconds') need pg_cron 1.5+; staging has 1.6.4.

alter table public.messages
  add column held_at timestamptz,
  add column after_cooldown boolean not null default false,
  add column status_id uuid references public.statuses (id) on delete set null;

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
  v_scheduled boolean;
  v_last timestamptz;
  v_want timestamptz;
  v_cool boolean;
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
  -- One message may wait behind the one going out (decision 138).
  select coalesce(bool_or(m.after_cooldown), false) into v_scheduled
    from public.messages m where m.ticket_id = t.id and m.status in ('queued', 'sending');
  if v_scheduled then
    raise exception 'a message for this ticket is already scheduled. Wait for it to go out, or cancel it'
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

  -- Every message waits 20 seconds (time to undo, and to hold it if the
  -- ticket moves); the next one goes 2 minutes after the previous one.
  select max(coalesce(m.sent_at, m.scheduled_for)) into v_last
    from public.messages m where m.ticket_id = t.id and m.status not in ('failed', 'canceled');
  v_want := v_now + interval '20 seconds';
  v_cool := v_last is not null and v_last + interval '2 minutes' > v_want;
  if v_cool then
    v_want := v_last + interval '2 minutes';
  end if;
  v_at := private.next_send_at(v_want, s.time_zone, s.quiet_hours_start, s.quiet_hours_end);
  insert into public.messages (shop_id, ticket_id, customer_id, channel, kind, subject, body, scheduled_for,
                               queued_for_quiet_hours, sent_by, after_cooldown, status_id)
  values (s.id, t.id, c.id, p_channel, p_kind, case when p_channel = 'email' then btrim(p_subject) end, btrim(p_body),
          v_at, v_at > v_want, (select auth.uid()), v_cool, case when p_kind = 'status' then t.status_id end)
  returning id into v_id;
  perform private.ticket_event(s.id, t.id, 'message', jsonb_build_object(
    'action', 'queued', 'channel', p_channel, 'kind', p_kind, 'message_id', v_id, 'scheduled_for', v_at));
  return query select v_id, v_at, v_at > v_want;
end;
$$;

create or replace function public.set_ticket_status(p_ticket_id uuid, p_status_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tickets;
  s_old public.statuses;
  s_new public.statuses;
begin
  select * into t from public.tickets where id = p_ticket_id and deleted_at is null for update;
  if not found or not private.has_role(t.shop_id, 'staff') then
    raise exception 'ticket not found' using errcode = 'P0002';
  end if;
  select * into s_new from public.statuses where id = p_status_id and shop_id = t.shop_id;
  if not found then
    raise exception 'status not found' using errcode = 'P0002';
  end if;
  if s_new.id = t.status_id then
    return;
  end if;
  select * into s_old from public.statuses where id = t.status_id;
  update public.tickets set
    status_id = s_new.id,
    status_changed_at = now(),
    picked_up_at = case when s_new.is_final then now() else null end,
    passcode_encrypted = case when s_new.is_final then null else passcode_encrypted end
  where id = t.id;
  -- Messages that haven't gone out are held: the person who moved the ticket
  -- is asked whether to still send them; without an answer they go after a
  -- minute (decision 138).
  update public.messages set held_at = now()
   where ticket_id = t.id and status = 'queued' and held_at is null;
  perform private.ticket_event(t.shop_id, t.id, 'status_change',
    jsonb_build_object('from', s_old.name, 'to', s_new.name, 'to_category', s_new.category));
  if s_new.is_final and t.passcode_encrypted is not null then
    perform private.ticket_event(t.shop_id, t.id, 'passcode_purged');
  end if;
end;
$$;

create or replace function public.claim_due_messages(p_limit integer default 20)
returns table (
  message_id uuid, channel public.message_channel, recipient text, subject text, body text,
  shop_name text, reply_to text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.messages m set status = 'canceled', error = 'customer opted out'
    from public.customers c
   where c.id = m.customer_id and m.status = 'queued' and m.scheduled_for <= now()
     and ((m.channel = 'sms' and c.sms_opted_out) or (m.channel = 'email' and c.email_opted_out));

  return query
  with due as (
    select m.id from public.messages m
     where m.status = 'queued' and m.scheduled_for <= now() and m.attempts < 3
       and (m.held_at is null or m.held_at <= now() - interval '1 minute')
     order by m.scheduled_for
     limit greatest(1, least(coalesce(p_limit, 20), 100))
     for update skip locked
  ), claimed as (
    update public.messages m set status = 'sending', attempts = m.attempts + 1
      from due where m.id = due.id
    returning m.*
  )
  select cl.id, cl.channel,
         case cl.channel when 'sms' then private.pii_decrypt(c.phone_encrypted) else private.pii_decrypt(c.email_encrypted) end,
         cl.subject, cl.body, s.name, s.email
    from claimed cl
    join public.customers c on c.id = cl.customer_id
    join public.shops s on s.id = cl.shop_id;
end;
$$;

create or replace function private.dispatch_due_messages()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := private.secret('mend_project_url');
  v_key text := private.secret('mend_publishable_key');
begin
  if v_url is null or v_key is null then
    return;
  end if;
  if not exists (select 1 from public.messages m where m.status = 'queued' and m.scheduled_for <= now() and m.attempts < 3
                   and (m.held_at is null or m.held_at <= now() - interval '1 minute')) then
    return;
  end if;
  perform net.http_post(
    url := v_url || '/functions/v1/send-messages',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_key, 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb
  );
end;
$$;

-- Send a held message now (the person who moved the ticket said Send).
create function public.release_held_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages;
begin
  select * into m from public.messages where id = p_message_id for update;
  if not found or not private.has_role(m.shop_id, 'staff') then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  if m.status <> 'queued' then
    raise exception 'this message is already on its way' using errcode = '22023';
  end if;
  update public.messages set held_at = null where id = m.id;
end;
$$;

-- The earlier message a new one would repeat, if any: the same status update
-- (same status), or the same text on the same channel. Failed and canceled
-- messages don't count. Texts are compared the way they are stored (plain
-- punctuation, and the STOP notice the first text gets).
create function public.find_repeat_message(p_ticket_id uuid, p_kind text, p_channel public.message_channel, p_body text)
returns table (created_at timestamptz, channel public.message_channel, kind text, sent_by uuid, status public.message_status)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tickets;
  v_body text;
begin
  select * into t from public.tickets where id = p_ticket_id and deleted_at is null;
  if not found or not private.has_role(t.shop_id, 'staff') then
    raise exception 'ticket not found' using errcode = 'P0002';
  end if;
  v_body := btrim(coalesce(p_body, ''));
  if p_channel = 'sms' then
    v_body := private.sms_plain_text(v_body);
  end if;
  return query
  select m.created_at, m.channel, m.kind, m.sent_by, m.status
    from public.messages m
   where m.ticket_id = t.id and m.status not in ('failed', 'canceled')
     and ((p_kind = 'status' and m.kind = 'status' and m.status_id = t.status_id)
          or (m.channel = p_channel and v_body <> ''
              and (m.body = v_body
                   or (left(m.body, char_length(v_body)) = v_body
                       and substr(m.body, char_length(v_body) + 1) like ' Reply STOP to opt out.%'))))
   order by m.created_at desc
   limit 1;
end;
$$;

revoke execute on function
  public.release_held_message(uuid),
  public.find_repeat_message(uuid, text, public.message_channel, text)
from public, anon;
grant execute on function
  public.release_held_message(uuid),
  public.find_repeat_message(uuid, text, public.message_channel, text)
to authenticated;

select cron.schedule('mend-send-due-messages', '10 seconds', 'select private.dispatch_due_messages()');
