-- Fix: the automatic "Ticket created" email went out with its subject's
-- {placeholders} unfilled ("Your {ticket_title} at {shop_name}"). The subject
-- is now rendered with the same values as the body. Same signature, so the
-- function keeps its privileges.

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
  -- The subject has the same {placeholders} as the body (it was sent raw).
  perform public.queue_message(t.id, ch, v_body,
    nullif(private.render_message_template(tpl.subject, v_vars), ''), 'created');
end;
$$;
