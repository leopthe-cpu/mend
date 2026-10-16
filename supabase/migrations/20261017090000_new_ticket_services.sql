-- UX plan v2, PR 6b (15 Oct): new services typed during intake are saved
-- to the catalog in the same transaction, Admin-only.  Duplicate names
-- (case-insensitive, trimmed, non-archived) re-use the existing item.
-- "+ Tax" on a new service stores the chosen rates on the catalog item;
-- "+ Discount" stays on the ticket line only.  Payment method is always
-- "other" (the new dropdown has no method picker).

create or replace function public.create_ticket_full(
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
  v_name text;
  v_cat_id uuid;
  v_price bigint;
  v_tax_ids uuid[];
  v_kind public.payment_kind;
  v_amount bigint;
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
        -- New Service typed at intake: Admin only, saved to the catalog so
        -- it can be picked next time.  A matching non-archived name (case-
        -- insensitive, trimmed) re-uses the existing item.
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

  -- Payment: method is always "other" (the new dropdown has no method picker).
  if p_payment is not null and jsonb_typeof(p_payment) = 'object' then
    if coalesce((p_payment->>'full')::boolean, false) then
      v_kind := 'payment';
      v_amount := v_total;
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

  return query select v_ticket, v_number, v_estimate, v_total;
end;
$$;
