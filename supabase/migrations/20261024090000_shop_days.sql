-- Shop days (decision 79). The weekly schedule the shop sets in Settings
-- (shops.business_hours.schedule: [{day, open, opens, closes}, ...]) now drives:
--
-- 1. Ready-by dates: a ticket can't be promised for a day the shop is closed
--    (checked when the date is set or changed; older tickets are left alone).
-- 2. {promised_date} in messages adds that day's hours: "Mon, Oct 19 (open 9am–5pm)".
-- 3. {pickup_hours} says when the customer can come, from the moment the
--    message is written: "Open today until 5pm.", "Open today 9am–5pm." or
--    "Next open: Mon 9am–5pm." (day names, so a text held by quiet hours stays
--    true). {shop_hours} is still the weekly summary. The default reminder now
--    uses {pickup_hours}, like the default "Ready" message already did.
-- 4. {payment_line} is empty when nothing is due (was "Payment of $0.00 ...").
--
-- A shop without a schedule, or with every day closed (a setup slip), counts
-- as open every day and {pickup_hours} falls back to the hours text. The app
-- has the same rules in src/lib/hours.ts; keep them in step.

create function private.shop_day(p_hours jsonb, p_date date)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select d
    from jsonb_array_elements(case when jsonb_typeof(p_hours -> 'schedule') = 'array'
                                   then p_hours -> 'schedule' else '[]'::jsonb end) d
   where d ->> 'day' = (array['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])
                       [extract(isodow from p_date)::int]
   limit 1;
$$;

create function private.has_schedule(p_hours jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_hours -> 'schedule') = 'array'
     and exists (select 1 from jsonb_array_elements(p_hours -> 'schedule') d
                  where coalesce((d ->> 'open')::boolean, false));
$$;

create function private.shop_open_on(p_hours jsonb, p_date date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not coalesce(private.has_schedule(p_hours), false)
      or coalesce((private.shop_day(p_hours, p_date) ->> 'open')::boolean, false);
$$;

-- "09:00" → "9am", "14:30" → "2:30pm", "12:00" → "12pm" (formatHourLabel in hours.ts).
create function private.hour_label(p_time text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  h integer := split_part(p_time, ':', 1)::integer;
  m integer := split_part(p_time, ':', 2)::integer;
begin
  return ((h + 11) % 12 + 1)::text
         || case when m = 0 then '' else ':' || lpad(m::text, 2, '0') end
         || case when h >= 12 then 'pm' else 'am' end;
end;
$$;

create function private.promised_text(p_hours jsonb, p_date date)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  d jsonb;
begin
  if p_date is null then
    return 'a date to be confirmed';
  end if;
  d := private.shop_day(p_hours, p_date);
  return to_char(p_date, 'Dy, Mon FMDD')
         || case when private.has_schedule(p_hours) and coalesce((d ->> 'open')::boolean, false)
                 then ' (open ' || private.hour_label(d ->> 'opens') || '–' || private.hour_label(d ->> 'closes') || ')'
                 else '' end;
end;
$$;

create function private.pickup_hours_text(p_hours jsonb, p_time_zone text, p_now timestamptz)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local timestamp := p_now at time zone p_time_zone;
  v_today date := v_local::date;
  v_time text := to_char(v_local, 'HH24:MI');
  d jsonb;
  i integer;
begin
  if not coalesce(private.has_schedule(p_hours), false) then
    return coalesce(p_hours ->> 'text', '');
  end if;
  d := private.shop_day(p_hours, v_today);
  if coalesce((d ->> 'open')::boolean, false) and v_time < d ->> 'closes' then
    if v_time < d ->> 'opens' then
      return 'Open today ' || private.hour_label(d ->> 'opens') || '–' || private.hour_label(d ->> 'closes') || '.';
    end if;
    return 'Open today until ' || private.hour_label(d ->> 'closes') || '.';
  end if;
  for i in 1..7 loop
    d := private.shop_day(p_hours, v_today + i);
    if coalesce((d ->> 'open')::boolean, false) then
      return 'Next open: ' || to_char(v_today + i, 'Dy') || ' '
             || private.hour_label(d ->> 'opens') || '–' || private.hour_label(d ->> 'closes') || '.';
    end if;
  end loop;
  return coalesce(p_hours ->> 'text', '');
end;
$$;

-- 1. No ready-by date on a closed day.
create function private.check_promised_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hours jsonb;
begin
  if new.promised_date is not null
     and (tg_op = 'INSERT' or new.promised_date is distinct from old.promised_date) then
    select business_hours into v_hours from public.shops where id = new.shop_id;
    if not private.shop_open_on(v_hours, new.promised_date) then
      raise exception 'the shop is closed on %. Pick a day it is open', to_char(new.promised_date, 'FMDay, Mon FMDD')
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger tickets_check_promised_date
  before insert or update of promised_date on public.tickets
  for each row execute function private.check_promised_date();

-- 2 and 3. The "Ticket created" message uses the new texts.
create or replace function private.queue_created_message(p_ticket_id uuid, p_paid_full boolean, p_amount_due bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tickets;
  s public.shops;
  c public.customers;
  ch public.message_channel;
  tpl public.message_templates;
  v_payment_line text;
  v_vars jsonb;
  v_body text;
begin
  select * into t from public.tickets where id = p_ticket_id;
  select * into s from public.shops where id = t.shop_id;
  select * into c from public.customers where id = t.customer_id;

  ch := c.preferred_channel::text::public.message_channel;
  if ch = 'sms' and c.phone_encrypted is null and c.email_encrypted is not null then
    ch := 'email';
  elsif ch = 'email' and c.email_encrypted is null and c.phone_encrypted is not null then
    ch := 'sms';
  end if;

  select * into tpl
    from public.message_templates
   where shop_id = s.id and kind = 'created' and channel = ch
   limit 1;
  if not found then
    return;
  end if;

  -- No "Payment of $0.00" line when the ticket has no price yet.
  v_payment_line := case when p_paid_full then 'It''s paid in full.'
                         when coalesce(p_amount_due, 0) > 0
                           then 'Payment of ' || private.money_text(p_amount_due, s.currency) || ' is due at pick-up.'
                         else '' end;
  v_vars := jsonb_build_object(
    'customer_first_name', split_part(btrim(c.name), ' ', 1),
    'customer_name', btrim(c.name),
    'shop_name', s.name,
    'ticket_title', t.item_name,
    'item_name', t.item_name,
    'ticket_number', '#' || t.ticket_number,
    'promised_date', private.promised_text(s.business_hours, t.promised_date),
    'shop_hours', coalesce(s.business_hours ->> 'text', ''),
    'pickup_hours', private.pickup_hours_text(s.business_hours, s.time_zone, now()),
    'amount_due', private.money_text(p_amount_due, s.currency),
    'payment_line', v_payment_line
  );
  v_body := private.render_message_template(tpl.body, v_vars);
  perform public.queue_message(t.id, ch, v_body, tpl.subject, 'created');
end;
$$;

-- The default reminder says when to come, like the default "Ready" message.
create or replace function private.pr8_default_body(p_kind text, p_channel public.message_channel)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'created' then 'Hi {customer_first_name}, thanks for visiting {shop_name}. Your order {ticket_title} ({ticket_number}) will be ready on {promised_date}. {payment_line}'
    when 'reminder' then 'Hi {customer_first_name}, a reminder that your {ticket_title} is ready for pickup at {shop_name}. {pickup_hours}'
  end;
$$;
-- Shops still on the old default get the new one; edited templates are kept.
update public.message_templates
   set body = 'Hi {customer_first_name}, a reminder that your {ticket_title} is ready for pickup at {shop_name}. {pickup_hours}'
 where kind = 'reminder'
   and body = 'Hi {customer_first_name}, a reminder that your {ticket_title} is ready for pickup at {shop_name}. {shop_hours}';

revoke execute on function
  private.shop_day(jsonb, date),
  private.has_schedule(jsonb),
  private.shop_open_on(jsonb, date),
  private.hour_label(text),
  private.promised_text(jsonb, date),
  private.pickup_hours_text(jsonb, text, timestamptz),
  private.check_promised_date()
  from public, anon, authenticated;
