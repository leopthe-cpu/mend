-- New-ticket fixes after Oz's staging test (16 Oct, decision 80):
--
-- 1. create_ticket_full: a catalog line may carry price_cents. Catalog items
--    seeded at $0 (like "Labor") can then be priced on the ticket. It goes
--    through update_estimate_line, which allows a price change only for the
--    Owner or an Admin (CLAUDE.md permissions) and audits it.
-- 2. set_estimate_discount: when the services add up to $0 the message now
--    says so (it said "add a service before a discount", which was wrong when
--    a $0 service was there).
-- Both are create or replace with the same signatures, so grants are kept.

create or replace function public.set_estimate_discount(
  p_estimate_id uuid,
  p_type public.discount_type,
  p_value numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.estimates;
  v_lines bigint;
begin
  e := private.editable_estimate(p_estimate_id);
  perform private.require_admin(e.shop_id, 'change discounts');
  if p_type is not null then
    if p_value is null or p_value <= 0 or (p_type = 'percent' and p_value > 100) then
      raise exception 'a percent discount is 0 to 100; an amount must be more than 0' using errcode = '22023';
    end if;
    select coalesce(sum(line_total_cents), 0) into v_lines
      from public.estimate_line_items where estimate_id = e.id;
    if v_lines = 0 then
      raise exception 'the services have no price yet, so there is nothing to discount' using errcode = '22023';
    end if;
    if p_type = 'fixed' and round(p_value * 100) > v_lines then
      raise exception 'the discount can''t be more than the services ($%)',
        to_char(v_lines / 100.0, 'FM999999990.00') using errcode = '22023';
    end if;
  end if;
  update public.estimates set
    discount_type = p_type,
    discount_value = case when p_type is not null then round(p_value, 2) end
  where id = e.id;
  perform private.audit(e.shop_id, 'estimate.discount', 'estimates', e.id,
    jsonb_build_object('type', e.discount_type, 'value', e.discount_value),
    jsonb_build_object('type', p_type, 'value', case when p_type is not null then round(p_value, 2) end));
  perform private.recalc_estimate(e.id);
end;
$$;

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
  p_payment jsonb default null,
  p_updates_consent boolean default false,
  p_discount jsonb default null
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
  v_amount_due bigint := 0;
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
  if p_discount is not null and jsonb_typeof(p_discount) = 'object'
     and nullif(p_discount->>'type', '') is not null
     and jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'add a service before a discount' using errcode = '22023';
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
        -- A price typed for a catalog item (Admins; update_estimate_line
        -- checks the role and audits the override).
        if nullif(v_line->>'price_cents', '') is not null
           and (v_line->>'price_cents')::bigint is distinct from
               (select l.unit_price_cents from public.estimate_line_items l where l.id = v_line_id) then
          perform public.update_estimate_line(v_line_id, null, (v_line->>'price_cents')::bigint);
        end if;
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
    if p_discount is not null and jsonb_typeof(p_discount) = 'object'
       and nullif(p_discount->>'type', '') is not null then
      perform public.set_estimate_discount(
        v_estimate, (p_discount->>'type')::public.discount_type, (p_discount->>'value')::numeric);
    end if;
    select e.total_cents into v_total
      from public.estimates e where e.id = v_estimate;
  end if;
  v_amount_due := v_total;

  if p_payment is not null and jsonb_typeof(p_payment) = 'object' then
    if coalesce((p_payment->>'full')::boolean, false) then
      v_kind := 'payment';
      v_amount := v_total;
      v_paid_full := true;
      v_amount_due := 0;
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
      v_amount_due := v_total - v_amount;
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
      perform private.queue_created_message(v_ticket, v_paid_full, v_amount_due);
    exception when others then
      perform private.audit(p_shop_id, 'message.created_skipped', 'tickets', v_ticket, null,
        jsonb_build_object('reason', sqlerrm));
    end;
  end if;

  return query select v_ticket, v_number, v_estimate, v_total;
end;
$$;
