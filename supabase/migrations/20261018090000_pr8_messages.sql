-- PR 8: three message templates (Ticket created / Ticket ready / Reminder)
-- and an automatic "ticket created" message.  We reuse message_templates
-- (RLS, audit and export already cover it) and add a `kind` column instead of
-- a new table.  Existing status templates (kind 'status') keep working.

-- 1) messages.kind gains 'created'; queue_message accepts it (same signature
--    and defaults, every existing check kept).
alter table public.messages drop constraint messages_kind_check;
alter table public.messages add constraint messages_kind_check
  check (kind in ('status', 'reminder', 'manual', 'created'));

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

-- 2) message_templates gains `kind`; status_id becomes nullable and the two
--    shapes are mutually exclusive; the old unique becomes two partial ones.
alter table public.message_templates
  add column kind text not null default 'status'
    check (kind in ('status', 'created', 'reminder'));
alter table public.message_templates alter column status_id drop not null;
alter table public.message_templates
  add constraint message_templates_kind_status_check check ((kind = 'status') = (status_id is not null));
alter table public.message_templates drop constraint message_templates_status_id_channel_key;
create unique index message_templates_status_id_channel_key
  on public.message_templates (status_id, channel) where kind = 'status';
create unique index message_templates_shop_kind_channel_key
  on public.message_templates (shop_id, kind, channel) where kind <> 'status';

-- 3) Default text bodies shared by seeding and the UI.
create function private.pr8_default_body(p_kind text, p_channel public.message_channel)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'created' then 'Hi {customer_first_name}, thanks for visiting {shop_name}. Your order {ticket_title} (#{ticket_number}) will be ready on {promised_date}. {payment_line}'
    when 'reminder' then 'Hi {customer_first_name}, a reminder that your {ticket_title} is ready for pickup at {shop_name}. {shop_hours}'
  end;
$$;
create function private.pr8_default_subject(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'created' then 'Your {ticket_title} at {shop_name}'
    when 'reminder' then 'Reminder: your {ticket_title} is ready for pickup'
  end;
$$;

-- 4) Seed created + reminder templates for existing shops (only if absent).
insert into public.message_templates (shop_id, kind, channel, subject, body)
select s.id, k.kind, c.channel,
       case when c.channel = 'email' then private.pr8_default_subject(k.kind) end,
       private.pr8_default_body(k.kind, c.channel)
  from public.shops s
  cross join (values ('created'), ('reminder')) k(kind)
  cross join (values ('sms'::public.message_channel), ('email'::public.message_channel)) c(channel)
on conflict do nothing;

-- 5) Store messaging consent on the ticket (CASL).
alter table public.tickets add column updates_consent boolean not null default false;
alter table public.tickets add column updates_consent_at timestamptz;
alter table public.tickets add column updates_consent_by uuid references auth.users (id) on delete set null;

-- 6) Shared SQL renderer and money formatter (private).
create function private.render_message_template(p_body text, p_vars jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := coalesce(p_body, '');
  k text;
begin
  for k in select * from jsonb_object_keys(coalesce(p_vars, '{}'::jsonb)) loop
    v := replace(v, '{' || k || '}', coalesce(p_vars ->> k, ''));
  end loop;
  return btrim(v);
end;
$$;
create function private.money_text(p_cents bigint, p_currency text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  return case when p_currency = 'USD' then 'US$' else '$' end
         || to_char(coalesce(p_cents, 0) / 100.0, 'FM999999990.00');
end;
$$;

-- 7) Best-effort automatic "Ticket created" message.  The preferred channel is
--    used; the other only when the preferred contact is MISSING (never when
--    opted out — queue_message re-checks that).
create function private.queue_created_message(p_ticket_id uuid, p_paid_full boolean, p_total bigint)
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
  v_promised text;
  v_payment_line text;
  v_vars jsonb;
  v_body text;
begin
  select * into t from public.tickets where id = p_ticket_id;
  select * into s from public.shops where id = t.shop_id;
  select * into c from public.customers where id = t.customer_id;

  ch := c.preferred_channel;
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

  v_promised := coalesce(t.promised_date::text, 'a date to be confirmed');
  v_payment_line := case when p_paid_full then 'It''s paid in full.'
                         else 'Payment of ' || private.money_text(p_total, s.currency) || ' is due at pick-up.' end;
  v_vars := jsonb_build_object(
    'customer_first_name', split_part(btrim(c.name), ' ', 1),
    'customer_name', split_part(btrim(c.name), ' ', 1),
    'shop_name', s.name,
    'ticket_title', t.item_name,
    'item_name', t.item_name,
    'ticket_number', '#' || t.ticket_number,
    'promised_date', v_promised,
    'shop_hours', coalesce(s.business_hours ->> 'text', ''),
    'pickup_hours', coalesce(s.business_hours ->> 'text', ''),
    'amount_due', private.money_text(p_total, s.currency),
    'payment_line', v_payment_line
  );
  v_body := private.render_message_template(tpl.body, v_vars);
  perform public.queue_message(t.id, ch, v_body, tpl.subject, 'created');
end;
$$;

-- 8) New shops get created + reminder templates (kind-based).  insert_trade_seed
--    also runs on a trade change, so use on conflict do nothing against the
--    (shop_id, kind, channel) partial unique index.
create or replace function private.insert_trade_seed(p_shop_id uuid, p_vertical public.shop_vertical, p_skip_final boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seed jsonb := private.trade_seed(p_vertical);
  v_ready uuid;
  s jsonb;
  i integer := 0;
begin
  for s in select * from jsonb_array_elements(v_seed -> 'statuses') loop
    i := i + 1;
    if p_skip_final and (s ->> 3)::boolean then
      continue;
    end if;
    insert into public.statuses (shop_id, name, position, category, color, notify_by_default, is_final)
    values (p_shop_id, s ->> 0, i, (s ->> 1)::public.status_category, s ->> 2, (s ->> 1) = 'ready', (s ->> 3)::boolean);
  end loop;

  select id into v_ready from public.statuses
   where shop_id = p_shop_id and category = 'ready' order by position limit 1;
  insert into public.message_templates (shop_id, status_id, channel, subject, body) values
    (p_shop_id, v_ready, 'sms', null,
     'Hi {customer_name}, your {item_name} is ready for pickup at {shop_name}. {pickup_hours}'),
    (p_shop_id, v_ready, 'email', 'Your {item_name} is ready for pickup',
     'Hi {customer_name}, your {item_name} is ready for pickup at {shop_name}. {pickup_hours}');

  insert into public.message_templates (shop_id, kind, channel, subject, body)
  select p_shop_id, k.kind, c.channel,
         case when c.channel = 'email' then private.pr8_default_subject(k.kind) end,
         private.pr8_default_body(k.kind, c.channel)
    from (values ('created'), ('reminder')) k(kind)
    cross join (values ('sms'::public.message_channel), ('email'::public.message_channel)) c(channel)
  on conflict do nothing;

  i := 0;
  for s in select * from jsonb_array_elements(v_seed -> 'fields') loop
    i := i + 1;
    insert into public.custom_field_definitions (shop_id, label, field_type, options, position, help_text)
    values (p_shop_id, s ->> 0, (s ->> 1)::public.custom_field_type, s -> 2, i, s ->> 3);
  end loop;

  for s in select * from jsonb_array_elements(v_seed -> 'catalog') loop
    if not exists (select 1 from public.catalog_items c where c.shop_id = p_shop_id and c.name = s ->> 0) then
      insert into public.catalog_items (shop_id, name, item_type, unit, price_cents)
      values (p_shop_id, s ->> 0, (s ->> 1)::public.catalog_item_type, (s ->> 2)::public.catalog_unit, 0);
    end if;
  end loop;
end;
$$;

-- 9) create_ticket_full gains p_updates_consent (default FALSE).  Store it,
--    then best-effort queue the "created" message (audited on skip).
drop function public.create_ticket_full(uuid, uuid, text, text, date, uuid, jsonb, text, boolean, jsonb, jsonb);
create function public.create_ticket_full(
  p_shop_id uuid,
  p_customer_id uuid,
  p_issue_description text,
  p_item_name text default null,
  p_promised_date date default null,
  p_assigned_to uuid default null,
  p_custom_fields jsonb default '{}'::jsonb,
  p_passcode text default null,
  p_terms_accepted boolean default false,
  p_lines jsonb default '[]'::jsonb,
  p_payment jsonb default null,
  p_updates_consent boolean default false
)
returns table (ticket_id uuid, ticket_number integer, estimate_id uuid, total_cents bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_desc text := nullif(btrim(coalesce(p_issue_description, '')), '');
  v_title text := nullif(btrim(coalesce(p_item_name, '')), '');
  v_ticket uuid;
  v_number integer;
  v_estimate uuid;
  v_total bigint := 0;
  v_line jsonb;
  v_line_id uuid;
  v_name text;
  v_cat_id uuid;
  v_price bigint;
  v_tax_ids uuid[];
  v_kind public.payment_kind;
  v_amount bigint;
  v_paid_full boolean := false;
begin
  if v_desc is null and v_title is null then
    raise exception 'describe what needs doing' using errcode = '22023';
  end if;
  v_title := coalesce(v_title, private.title_from_text(v_desc));
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 50 then
    raise exception 'up to 50 lines per ticket' using errcode = '22023';
  end if;

  select c.ticket_id, c.ticket_number into v_ticket, v_number
    from public.create_ticket(p_shop_id, p_customer_id, v_title, v_desc, null,
                              p_promised_date, p_assigned_to, p_custom_fields,
                              p_passcode, p_terms_accepted) c;

  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 0 then
    v_estimate := public.start_estimate(v_ticket);
    for v_line in select value from jsonb_array_elements(p_lines) loop
      if nullif(v_line->>'catalog_item_id', '') is not null then
        v_line_id := public.add_estimate_line(
          v_estimate, (v_line->>'catalog_item_id')::uuid,
          coalesce((v_line->>'quantity')::numeric, 1), null);
      else
        if not private.has_role(p_shop_id, 'admin') then
          raise exception 'only admins can add new catalog services'
            using errcode = '42501';
        end if;
        v_name := btrim(v_line->>'name');
        if v_name = '' then
          raise exception 'a new service needs a name'
            using errcode = '22023';
        end if;
        select c.id into v_cat_id
          from public.catalog_items c
         where c.shop_id = p_shop_id
           and c.archived_at is null
           and lower(btrim(c.name)) = lower(v_name)
         limit 1;
        if v_cat_id is null then
          v_price := coalesce((v_line->>'price_cents')::bigint, 0);
          if jsonb_typeof(v_line->'tax_rate_ids') = 'array' then
            select coalesce(array_agg(x::uuid), '{}')
              into v_tax_ids
              from jsonb_array_elements_text(v_line->'tax_rate_ids') x;
          end if;
          v_cat_id := public.save_catalog_item(
            p_shop_id, null, v_name, null, 'service', 'each', v_price,
            null, null, null, null, null, v_tax_ids);
        end if;
        v_line_id := public.add_estimate_line(
          v_estimate, v_cat_id,
          coalesce((v_line->>'quantity')::numeric, 1), null);
      end if;
      if nullif(v_line->>'discount_type', '') is not null then
        perform public.set_line_discount(
          v_line_id, (v_line->>'discount_type')::public.discount_type,
          (v_line->>'discount_value')::numeric, null);
      end if;
    end loop;
    select e.total_cents into v_total
      from public.estimates e where e.id = v_estimate;
  end if;

  if p_payment is not null and jsonb_typeof(p_payment) = 'object' then
    if coalesce((p_payment->>'full')::boolean, false) then
      v_kind := 'payment';
      v_amount := v_total;
      v_paid_full := true;
      if v_amount <= 0 then
        raise exception 'add a price before marking it paid'
          using errcode = '22023';
      end if;
    else
      v_kind := 'deposit';
      v_amount := (p_payment->>'amount_cents')::bigint;
      if v_amount is null or v_amount <= 0 then
        raise exception 'enter the deposit amount'
          using errcode = '22023';
      end if;
      if v_total > 0 and v_amount > v_total then
        raise exception 'the deposit is more than the total'
          using errcode = '22023';
      end if;
    end if;
    perform public.record_payment(
      v_ticket, v_kind, 'other', v_amount, null, null);
  end if;

  if p_updates_consent then
    update public.tickets set
      updates_consent = true,
      updates_consent_at = now(),
      updates_consent_by = (select auth.uid())
    where id = v_ticket;
    begin
      perform private.queue_created_message(v_ticket, v_paid_full, v_total);
    exception when others then
      perform private.audit(p_shop_id, 'message.created_skipped', 'tickets', v_ticket, null,
        jsonb_build_object('reason', sqlerrm));
    end;
  end if;

  return query select v_ticket, v_number, v_estimate, v_total;
end;
$$;

revoke execute on function
  private.pr8_default_body(text, public.message_channel),
  private.pr8_default_subject(text),
  private.render_message_template(text, jsonb),
  private.money_text(bigint, text),
  private.queue_created_message(uuid, boolean, bigint),
  private.insert_trade_seed(uuid, public.shop_vertical, boolean)
  from public, anon, authenticated;
revoke execute on function public.create_ticket_full(uuid, uuid, text, text, date, uuid, jsonb, text, boolean, jsonb, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.create_ticket_full(uuid, uuid, text, text, date, uuid, jsonb, text, boolean, jsonb, jsonb, boolean)
  to authenticated;
