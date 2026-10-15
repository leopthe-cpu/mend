-- UX plan v2, PR 6: the new-ticket flow (decision 69).
--
-- 1) create_ticket_full: one call, one transaction for the whole intake —
--    the ticket, an optional draft estimate with its lines (and admin
--    discounts), and an optional payment. If anything fails, nothing is
--    saved. Pricing is optional: a ticket with no lines has no estimate.
--    Every step reuses the existing functions, so their role checks still
--    apply (custom lines and discounts stay Admin-only).
-- 2) promised_date_counts: open tickets promised per day, for the pick-up
--    calendar.

-- Title from the description when the user left it blank: the first six
-- words, at most 120 characters (tickets.item_name can't be empty).
create function private.title_from_text(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(array_to_string((regexp_split_to_array(btrim(coalesce(p_text, '')), '\s+'))[1:6], ' '), 120);
$$;

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
  p_payment jsonb default null
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
  v_kind public.payment_kind;
  v_amount bigint;
begin
  if v_desc is null and v_title is null then
    raise exception 'describe what needs doing' using errcode = '22023';
  end if;
  v_title := coalesce(v_title, private.title_from_text(v_desc));
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 50 then
    raise exception 'up to 50 lines per ticket' using errcode = '22023';
  end if;

  -- Role check, numbering, status, passcode and terms all live here.
  select c.ticket_id, c.ticket_number into v_ticket, v_number
    from public.create_ticket(p_shop_id, p_customer_id, v_title, v_desc, null, p_promised_date,
                              p_assigned_to, p_custom_fields, p_passcode, p_terms_accepted) c;

  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 0 then
    v_estimate := public.start_estimate(v_ticket);
    for v_line in select value from jsonb_array_elements(p_lines) loop
      if nullif(v_line->>'catalog_item_id', '') is not null then
        v_line_id := public.add_estimate_line(v_estimate, (v_line->>'catalog_item_id')::uuid,
                                              coalesce((v_line->>'quantity')::numeric, 1), null);
      else
        -- A one-off line that isn't saved to the catalog (Admins only,
        -- enforced by add_custom_line).
        v_line_id := public.add_custom_line(
          v_estimate,
          v_line->>'name',
          coalesce((v_line->>'quantity')::numeric, 1),
          (v_line->>'price_cents')::bigint,
          coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(v_line->'tax_rate_ids', '[]'::jsonb)) x), '{}'),
          'each');
      end if;
      if nullif(v_line->>'discount_type', '') is not null then
        -- Admins only, enforced by set_line_discount.
        perform public.set_line_discount(v_line_id, (v_line->>'discount_type')::public.discount_type,
                                         (v_line->>'discount_value')::numeric, null);
      end if;
    end loop;
    select e.total_cents into v_total from public.estimates e where e.id = v_estimate;
  end if;

  -- Payment at intake: "paid in full" records the whole total; a deposit
  -- records the amount entered. "Pay at pick-up" sends nothing.
  if p_payment is not null and jsonb_typeof(p_payment) = 'object' then
    if coalesce((p_payment->>'full')::boolean, false) then
      v_kind := 'payment';
      v_amount := v_total;
      if v_amount <= 0 then
        raise exception 'add a price before marking it paid' using errcode = '22023';
      end if;
    else
      v_kind := 'deposit';
      v_amount := (p_payment->>'amount_cents')::bigint;
      if v_total > 0 and v_amount > v_total then
        raise exception 'the deposit is more than the total' using errcode = '22023';
      end if;
    end if;
    perform public.record_payment(v_ticket, v_kind, (p_payment->>'method')::public.payment_method, v_amount, null, null);
  end if;

  return query select v_ticket, v_number, v_estimate, v_total;
end;
$$;

create function public.promised_date_counts(p_shop_id uuid, p_from date, p_to date)
returns table (day date, open_tickets integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_shop_id, 'staff') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'pick a range of up to two months' using errcode = '22023';
  end if;
  return query
    select t.promised_date, count(*)::integer
      from public.tickets t
     where t.shop_id = p_shop_id
       and t.deleted_at is null
       and t.picked_up_at is null
       and t.promised_date between p_from and p_to
     group by t.promised_date
     order by t.promised_date;
end;
$$;

revoke execute on function private.title_from_text(text) from public, anon, authenticated;
revoke execute on function public.create_ticket_full(uuid, uuid, text, text, date, uuid, jsonb, text, boolean, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_ticket_full(uuid, uuid, text, text, date, uuid, jsonb, text, boolean, jsonb, jsonb) to authenticated;
revoke execute on function public.promised_date_counts(uuid, date, date) from public, anon, authenticated;
grant execute on function public.promised_date_counts(uuid, date, date) to authenticated;
