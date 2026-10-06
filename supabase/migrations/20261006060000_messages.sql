-- Phase 4: customer notifications (docs/spec.md §7.10, Phase 4; addendum §7, §8).
--
-- * Nothing is ever sent automatically: a member confirms each message in the
--   app, which calls queue_message(). That checks opt-outs, the sender's
--   verified email, per-shop rate limits and the monthly SMS cap, and sets
--   scheduled_for to now, or to the end of the shop's quiet hours.
-- * The Edge Function `send-messages` (invoked right after queueing and every
--   minute by pg_cron) claims due messages through service-role-only functions
--   below, re-checks opt-outs, and calls Twilio or Resend. Provider keys live
--   only in Edge Function secrets.
-- * Webhook functions verify provider signatures, then record delivery
--   status and SMS opt-outs through the service-role-only functions.

create type public.message_status as enum ('queued', 'sending', 'sent', 'delivered', 'failed', 'canceled');

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  ticket_id uuid not null,
  customer_id uuid not null,
  channel public.message_channel not null,
  kind text not null default 'status' check (kind in ('status', 'reminder', 'manual')),
  subject text check (char_length(subject) <= 200),
  body text not null check (char_length(btrim(body)) between 1 and 1600),
  status public.message_status not null default 'queued',
  scheduled_for timestamptz not null default now(),
  queued_for_quiet_hours boolean not null default false,
  attempts integer not null default 0,
  provider text,
  provider_message_id text,
  error text check (char_length(error) <= 500),
  sent_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (shop_id, id),
  foreign key (shop_id, ticket_id) references public.tickets (shop_id, id) on delete cascade,
  foreign key (shop_id, customer_id) references public.customers (shop_id, id) on delete cascade,
  check (channel = 'email' or subject is null)
);
create index messages_shop_created_idx on public.messages (shop_id, created_at desc);
create index messages_shop_ticket_idx on public.messages (shop_id, ticket_id);
create index messages_shop_customer_idx on public.messages (shop_id, customer_id);
create index messages_due_idx on public.messages (scheduled_for) where status = 'queued';
create index messages_provider_idx on public.messages (provider, provider_message_id) where provider_message_id is not null;
create index messages_sent_by_idx on public.messages (sent_by);
create trigger messages_set_updated_at before update on public.messages
  for each row execute function private.set_updated_at();

alter table public.messages enable row level security;
grant select on public.messages to authenticated;
create policy messages_select_members on public.messages for select to authenticated
  using (shop_id = any ((select private.my_shop_ids())::uuid[]));

-- The dispatcher and webhooks run as service_role (Edge Functions with the
-- secret key). They only use the functions below, never the tables directly.
---------------------------------------------------------------------------
-- Pure helper: when may a message confirmed at p_at be sent? Quiet hours are
-- [start, end) in shop-local time; an overnight window (21:00-08:00) wraps
-- midnight. Equal start and end means no quiet hours.
---------------------------------------------------------------------------
create function private.next_send_at(p_at timestamptz, p_time_zone text, p_start time, p_end time)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local timestamp := p_at at time zone p_time_zone;
  v_t time := v_local::time;
  v_day date := v_local::date;
begin
  if p_start = p_end then
    return p_at;
  end if;
  if p_start > p_end then
    -- Overnight window.
    if v_t >= p_start then
      return ((v_day + 1) + p_end) at time zone p_time_zone;
    elsif v_t < p_end then
      return (v_day + p_end) at time zone p_time_zone;
    end if;
  elsif v_t >= p_start and v_t < p_end then
    return (v_day + p_end) at time zone p_time_zone;
  end if;
  return p_at;
end;
$$;

---------------------------------------------------------------------------
-- Queue a confirmed message (any member). Spec §7.10, §4 abuse protection.
---------------------------------------------------------------------------
create function public.queue_message(
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
  if p_kind not in ('status', 'reminder', 'manual') then
    raise exception 'unknown message kind' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 1600 then
    raise exception 'write a message (up to 1600 characters)' using errcode = '22023';
  end if;
  if p_channel = 'email' and char_length(btrim(coalesce(p_subject, ''))) not between 1 and 200 then
    raise exception 'add an email subject' using errcode = '22023';
  end if;
  select * into s from public.shops where id = t.shop_id for update;  -- serializes the limit checks below per shop
  select * into c from public.customers where id = t.customer_id;

  -- Opt-outs and missing contacts are enforced here, not only in the UI.
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

  -- Rate limits (decision 44): 30 per shop per 10 minutes, 5 per ticket per hour.
  if (select count(*) from public.messages m where m.shop_id = s.id and m.created_at > v_now - interval '10 minutes') >= 30 then
    raise exception 'too many messages in the last few minutes. Try again shortly' using errcode = '54000';
  end if;
  if (select count(*) from public.messages m where m.ticket_id = t.id and m.created_at > v_now - interval '1 hour') >= 5 then
    raise exception 'this ticket already had 5 messages in the last hour' using errcode = '54000';
  end if;
  -- Monthly SMS cap, counted per calendar month in the shop's time zone.
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

-- Cancel a message that hasn't gone out yet (e.g. queued for quiet hours).
create function public.cancel_message(p_message_id uuid)
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
  update public.messages set status = 'canceled' where id = m.id;
  perform private.ticket_event(m.shop_id, m.ticket_id, 'message',
    jsonb_build_object('action', 'canceled', 'channel', m.channel, 'message_id', m.id));
end;
$$;

-- Mark a customer opted out (any member, e.g. they asked at the counter), or
-- back in (Owner/Admin only, audited: only with the customer's consent).
create function public.set_customer_opt_out(p_customer_id uuid, p_channel public.message_channel, p_opted_out boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.customers;
begin
  select * into c from public.customers where id = p_customer_id for update;
  if not found or not private.has_role(c.shop_id, 'staff') then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  if not p_opted_out and not private.has_role(c.shop_id, 'admin') then
    raise exception 'only the owner or an admin can turn messages back on' using errcode = '42501';
  end if;
  if p_channel = 'sms' then
    update public.customers set sms_opted_out = p_opted_out where id = c.id;
  else
    update public.customers set email_opted_out = p_opted_out where id = c.id;
  end if;
  -- Anything still waiting for that channel is canceled.
  if p_opted_out then
    update public.messages set status = 'canceled', error = 'customer opted out'
     where customer_id = c.id and channel = p_channel and status = 'queued';
  end if;
  perform private.audit(c.shop_id, 'customer.opt_out', 'customers', c.id,
    jsonb_build_object('channel', p_channel, 'opted_out', case p_channel when 'sms' then c.sms_opted_out else c.email_opted_out end),
    jsonb_build_object('channel', p_channel, 'opted_out', p_opted_out));
end;
$$;

---------------------------------------------------------------------------
-- Service-role only: dispatcher and webhooks.
---------------------------------------------------------------------------
-- Claim due messages (skip locked so overlapping runs never double-send),
-- cancel those whose customer opted out meanwhile, return what to send with
-- the decrypted recipient. Attempts are capped at 3.
create function public.claim_due_messages(p_limit integer default 20)
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

-- Record the outcome of a send attempt. A retryable failure goes back to the
-- queue (one minute later) until attempts run out.
create function public.record_send_result(
  p_message_id uuid,
  p_ok boolean,
  p_provider text,
  p_provider_message_id text default null,
  p_error text default null,
  p_retry boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages;
begin
  select * into m from public.messages where id = p_message_id for update;
  if not found then
    return;
  end if;
  if p_ok then
    update public.messages set status = 'sent', provider = p_provider, provider_message_id = p_provider_message_id,
      sent_at = now(), error = null where id = m.id;
    perform private.ticket_event(m.shop_id, m.ticket_id, 'message',
      jsonb_build_object('action', 'sent', 'channel', m.channel, 'message_id', m.id));
  elsif p_retry and m.attempts < 3 then
    update public.messages set status = 'queued', scheduled_for = now() + interval '1 minute',
      provider = p_provider, error = left(p_error, 500) where id = m.id;
  else
    update public.messages set status = 'failed', provider = p_provider, error = left(p_error, 500) where id = m.id;
    perform private.ticket_event(m.shop_id, m.ticket_id, 'message',
      jsonb_build_object('action', 'failed', 'channel', m.channel, 'message_id', m.id, 'error', left(p_error, 200)));
  end if;
end;
$$;

-- Delivery status from a verified provider webhook. Statuses never move
-- backwards (a late "sent" can't overwrite "delivered").
create function public.record_delivery_status(
  p_message_id uuid,
  p_provider text,
  p_provider_message_id text,
  p_status public.message_status,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages;
begin
  select * into m from public.messages
   where (p_message_id is not null and id = p_message_id and provider_message_id = p_provider_message_id)
      or (p_message_id is null and provider = p_provider and provider_message_id = p_provider_message_id)
   for update;
  if not found or m.status in ('delivered', 'failed', 'canceled') or p_status not in ('sent', 'delivered', 'failed') then
    return;
  end if;
  if p_status = 'sent' and m.status = 'sent' then
    return;
  end if;
  update public.messages set status = p_status,
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end,
    error = case when p_status = 'failed' then left(coalesce(p_error, 'not delivered'), 500) else error end
  where id = m.id;
  if p_status = 'failed' then
    perform private.ticket_event(m.shop_id, m.ticket_id, 'message',
      jsonb_build_object('action', 'failed', 'channel', m.channel, 'message_id', m.id, 'error', left(coalesce(p_error, 'not delivered'), 200)));
  end if;
end;
$$;

-- Inbound STOP/START on the shared Mend number, from a verified Twilio
-- webhook. The number is shared, so the opt-out applies in every shop that
-- has this customer (blind index is per shop, so compute it per shop).
create function public.record_sms_opt_out(p_phone text, p_opted_out boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_count integer := 0;
  r record;
begin
  begin
    v_phone := private.normalize_phone(p_phone);
  exception when others then
    return 0;
  end;
  if v_phone is null then
    return 0;
  end if;
  for r in
    update public.customers c set sms_opted_out = p_opted_out
     where c.phone_hash = private.blind_index(c.shop_id, v_phone) and c.sms_opted_out is distinct from p_opted_out
    returning c.id, c.shop_id
  loop
    v_count := v_count + 1;
    if p_opted_out then
      update public.messages set status = 'canceled', error = 'customer opted out'
       where customer_id = r.id and channel = 'sms' and status = 'queued';
    end if;
    perform private.audit(r.shop_id, case when p_opted_out then 'customer.sms_stop' else 'customer.sms_start' end,
      'customers', r.id, null, jsonb_build_object('source', 'inbound text'));
  end loop;
  return v_count;
end;
$$;

revoke execute on function
  private.next_send_at(timestamptz, text, time, time),
  public.queue_message(uuid, public.message_channel, text, text, text),
  public.cancel_message(uuid),
  public.set_customer_opt_out(uuid, public.message_channel, boolean),
  public.claim_due_messages(integer),
  public.record_send_result(uuid, boolean, text, text, text, boolean),
  public.record_delivery_status(uuid, text, text, public.message_status, text),
  public.record_sms_opt_out(text, boolean)
from public, anon, authenticated;
grant execute on function
  public.queue_message(uuid, public.message_channel, text, text, text),
  public.cancel_message(uuid),
  public.set_customer_opt_out(uuid, public.message_channel, boolean)
to authenticated;
grant execute on function
  public.claim_due_messages(integer),
  public.record_send_result(uuid, boolean, text, text, text, boolean),
  public.record_delivery_status(uuid, text, text, public.message_status, text),
  public.record_sms_opt_out(text, boolean)
to service_role;
