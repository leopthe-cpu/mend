-- Whole-ticket discount (decision 78). The new-ticket form drops per-line
-- manual discounts; a discount now applies to the whole ticket (per item only
-- through catalog discounts). It lives on the estimate:
--
-- * estimates.discount_type/value: percent (0-100) or a fixed amount, set by
--   the Owner or an Admin like line discounts (CLAUDE.md permissions).
-- * It comes off the sum of the discounted line totals. A fixed amount larger
--   than that is refused when set, and clamped if lines are removed later.
-- * Tax is still rounded once per rate (decision P2), on that rate's lines
--   minus its share of the ticket discount (proportional to the lines' totals),
--   because a discount given at the sale lowers the taxable amount.
-- * savings_cents and subtotal_cents include it, so invoices, PDFs and the
--   ticket view show it without changes; discount_cents holds the ticket
--   discount alone.

alter table public.estimates
  add column discount_type public.discount_type,
  add column discount_value numeric(12, 2),
  add column discount_cents bigint not null default 0 check (discount_cents >= 0),
  add constraint estimates_discount_pair check ((discount_type is null) = (discount_value is null));

create or replace function private.recalc_estimate(p_estimate_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.estimates;
  v_before bigint;
  v_line_savings bigint;
  v_lines bigint;
  v_disc bigint := 0;
  v_breakdown jsonb;
  v_tax bigint;
begin
  select * into e from public.estimates where id = p_estimate_id;
  select coalesce(sum(l.line_subtotal_cents), 0), coalesce(sum(l.discount_cents), 0),
         coalesce(sum(l.line_total_cents), 0)
    into v_before, v_line_savings, v_lines
    from public.estimate_line_items l
   where l.estimate_id = p_estimate_id;

  if e.discount_type = 'percent' then
    v_disc := round(v_lines * e.discount_value / 100)::bigint;
  elsif e.discount_type = 'fixed' then
    v_disc := least(round(e.discount_value * 100)::bigint, v_lines);
  end if;

  -- Each rate's base loses its share of the ticket discount. The share is
  -- base × discount / lines (base <= lines, so it never goes negative).
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'name', r.name, 'rate', r.rate,
           'taxable_cents', r.taxable, 'tax_cents', round(r.taxable * r.rate / 100)::bigint)
         order by r.name), '[]'::jsonb)
    into v_breakdown
    from (
      select g.id, g.name, g.rate,
             g.base - case when v_lines > 0 then round(g.base::numeric * v_disc / v_lines)::bigint else 0 end
               as taxable
        from (
          select t ->> 'id' as id, t ->> 'name' as name, (t ->> 'rate')::numeric as rate,
                 sum(l.line_total_cents) as base
            from public.estimate_line_items l
            cross join lateral jsonb_array_elements(l.tax_snapshot) t
           where l.estimate_id = p_estimate_id
           group by 1, 2, 3
        ) g
    ) r;
  select coalesce(sum((b ->> 'tax_cents')::bigint), 0) into v_tax from jsonb_array_elements(v_breakdown) b;

  update public.estimates set
    discount_cents = v_disc,
    subtotal_before_cents = v_before,
    savings_cents = v_line_savings + v_disc,
    subtotal_cents = v_lines - v_disc,
    tax_breakdown = v_breakdown,
    tax_cents = v_tax,
    total_cents = v_lines - v_disc + v_tax
  where id = p_estimate_id;
end;
$$;

-- Set, change or remove (p_type null) the whole-ticket discount. Owner/Admin.
create function public.set_estimate_discount(
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
      raise exception 'add a service before a discount' using errcode = '22023';
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
revoke execute on function public.set_estimate_discount(uuid, public.discount_type, numeric) from public, anon, authenticated;
grant execute on function public.set_estimate_discount(uuid, public.discount_type, numeric) to authenticated;

-- A revision keeps the ticket discount (same as the line snapshots).
create or replace function public.revise_estimate(p_estimate_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.estimates;
  v_id uuid;
begin
  select * into e from public.estimates where id = p_estimate_id for update;
  if not found or not private.has_role(e.shop_id, 'staff')
     or not exists (select 1 from public.tickets t where t.id = e.ticket_id and t.deleted_at is null) then
    raise exception 'estimate not found' using errcode = 'P0002';
  end if;
  if e.status in ('draft', 'superseded') then
    raise exception 'only a sent, approved or declined estimate can be revised' using errcode = '22023';
  end if;
  update public.estimates set status = 'superseded', superseded_at = now() where id = e.id;
  insert into public.estimates (shop_id, ticket_id, version, created_by, discount_type, discount_value)
  values (e.shop_id, e.ticket_id, e.version + 1, (select auth.uid()), e.discount_type, e.discount_value)
  returning id into v_id;
  insert into public.estimate_line_items (shop_id, estimate_id, position, catalog_item_id, is_custom, name_snapshot,
    unit_snapshot, catalog_unit_price_cents, unit_price_cents, quantity, discount_type, discount_value,
    discount_source, discount_reason, tax_snapshot, line_subtotal_cents, discount_cents, line_total_cents,
    added_on, created_by)
  select shop_id, v_id, position, catalog_item_id, is_custom, name_snapshot, unit_snapshot, catalog_unit_price_cents,
    unit_price_cents, quantity, discount_type, discount_value, discount_source, discount_reason, tax_snapshot,
    line_subtotal_cents, discount_cents, line_total_cents, added_on, created_by
    from public.estimate_line_items where estimate_id = e.id;
  perform private.recalc_estimate(v_id);
  perform private.audit(e.shop_id, 'estimate.revised', 'estimates', v_id,
    jsonb_build_object('from_version', e.version, 'from_status', e.status), jsonb_build_object('version', e.version + 1));
  perform private.ticket_event(e.shop_id, e.ticket_id, 'estimate',
    jsonb_build_object('action', 'revised', 'version', e.version + 1));
  return v_id;
end;
$$;

-- create_ticket_full gains p_discount: {"type": "percent"|"fixed", "value": n},
-- applied after the lines and before the payment, so "Paid in full" and the
-- "Ticket created" message use the discounted total.
drop function public.create_ticket_full(uuid, uuid, text, text, date, uuid, jsonb, text, boolean, jsonb, jsonb, boolean);
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
revoke execute on function public.create_ticket_full(uuid, uuid, text, text, date, uuid, jsonb, text, boolean, jsonb, jsonb, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_ticket_full(uuid, uuid, text, text, date, uuid, jsonb, text, boolean, jsonb, jsonb, boolean, jsonb)
  to authenticated;
