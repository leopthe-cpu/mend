-- Phase 3: catalog costs, versioned estimates, line items with discounts and
-- overrides, invoices and payments (docs/spec.md §6, §7.6-7.9, Phase 3).
--
-- Money rules (decisions P1, P2, 37):
-- * All amounts are integer cents; arithmetic on numeric, never floats.
--   round(numeric) is half away from zero (pinned by 004_rounding).
-- * Per line: subtotal = round(quantity × unit price); a percent discount is
--   round(subtotal × pct / 100); a fixed discount is an amount off the WHOLE
--   line (not per unit) and can't exceed the subtotal; total = subtotal - discount.
-- * Tax: once per tax rate per estimate, on the sum of discounted line totals
--   carrying that rate, rounded once.
-- * Lines snapshot name, unit, prices, discount and tax rates when added, so
--   later catalog changes never alter them. Totals are computed here and stored.
-- * Every write goes through the SECURITY DEFINER functions below, which check
--   the caller's role. Clients can only read these tables.

create type public.estimate_status as enum ('draft', 'sent', 'approved', 'declined', 'superseded');
create type public.approval_method as enum ('in_person', 'phone', 'text_reply', 'email_reply', 'other');
create type public.discount_source as enum ('catalog', 'manual');
create type public.payment_kind as enum ('deposit', 'payment', 'refund');
create type public.payment_method as enum ('cash', 'card', 'e_transfer', 'other');

---------------------------------------------------------------------------
-- Internal cost per catalog item: Owner only (separate table so RLS can hide it).
---------------------------------------------------------------------------
create table public.catalog_item_costs (
  catalog_item_id uuid primary key,
  shop_id uuid not null,
  cost_cents bigint not null check (cost_cents >= 0 and cost_cents <= 100000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (shop_id, catalog_item_id) references public.catalog_items (shop_id, id) on delete cascade
);
create index catalog_item_costs_shop_idx on public.catalog_item_costs (shop_id);
alter table public.catalog_item_costs enable row level security;
grant select, insert, update, delete on public.catalog_item_costs to authenticated;
create policy catalog_item_costs_owner on public.catalog_item_costs
  for all to authenticated
  using ((select private.has_role(shop_id, 'owner')))
  with check ((select private.has_role(shop_id, 'owner')));
create trigger catalog_item_costs_set_updated_at before update on public.catalog_item_costs
  for each row execute function private.set_updated_at();
create trigger catalog_item_costs_audit after insert or update or delete on public.catalog_item_costs
  for each row execute function private.audit_row_change();

---------------------------------------------------------------------------
-- Estimates (one current version per ticket; older versions are superseded)
---------------------------------------------------------------------------
create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  ticket_id uuid not null,
  version integer not null check (version >= 1),
  status public.estimate_status not null default 'draft',
  sent_at timestamptz,
  approved_at timestamptz,
  approval_method public.approval_method,
  declined_at timestamptz,
  superseded_at timestamptz,
  subtotal_before_cents bigint not null default 0,
  savings_cents bigint not null default 0,
  subtotal_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  tax_breakdown jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ticket_id, version),
  unique (shop_id, id),
  foreign key (shop_id, ticket_id) references public.tickets (shop_id, id) on delete cascade,
  check ((status = 'approved') = (approval_method is not null) or status = 'superseded')
);
create unique index estimates_one_current_per_ticket on public.estimates (ticket_id) where status <> 'superseded';
create index estimates_shop_ticket_idx on public.estimates (shop_id, ticket_id);
create index estimates_created_by_idx on public.estimates (created_by);

create table public.estimate_line_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  estimate_id uuid not null,
  position integer not null,
  catalog_item_id uuid,
  is_custom boolean not null default false,
  name_snapshot text not null check (char_length(btrim(name_snapshot)) between 1 and 120),
  unit_snapshot public.catalog_unit not null default 'each',
  catalog_unit_price_cents bigint check (catalog_unit_price_cents >= 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0 and unit_price_cents <= 100000000),
  quantity numeric(10, 2) not null check (quantity > 0 and quantity <= 10000),
  discount_type public.discount_type,
  discount_value numeric(12, 2),
  discount_source public.discount_source,
  discount_reason text check (char_length(discount_reason) <= 200),
  tax_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(tax_snapshot) = 'array'),
  line_subtotal_cents bigint not null,
  discount_cents bigint not null default 0,
  line_total_cents bigint not null,
  added_on date not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (shop_id, estimate_id) references public.estimates (shop_id, id) on delete cascade,
  -- Deleting a catalog item never touches lines (they keep their snapshot).
  foreign key (shop_id, catalog_item_id) references public.catalog_items (shop_id, id) on delete set null (catalog_item_id),
  -- Custom lines have no catalog link or catalog price; catalog lines keep the price snapshot.
  check (is_custom = (catalog_unit_price_cents is null)),
  check (not is_custom or catalog_item_id is null),
  check ((discount_type is null) = (discount_value is null) and (discount_type is null) = (discount_source is null)),
  check (discount_cents >= 0 and discount_cents <= line_subtotal_cents),
  check (line_total_cents = line_subtotal_cents - discount_cents)
);
create index estimate_line_items_estimate_idx on public.estimate_line_items (shop_id, estimate_id, position);
create index estimate_line_items_catalog_idx on public.estimate_line_items (shop_id, catalog_item_id);
create index estimate_line_items_created_by_idx on public.estimate_line_items (created_by);

---------------------------------------------------------------------------
-- Invoices (issued from an approved estimate; totals and shop details frozen)
---------------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  ticket_id uuid not null,
  estimate_id uuid not null unique,
  invoice_number integer not null,
  issued_at timestamptz not null default now(),
  issued_by uuid references auth.users (id) on delete set null,
  voided_at timestamptz,
  subtotal_before_cents bigint not null,
  savings_cents bigint not null,
  subtotal_cents bigint not null,
  tax_cents bigint not null,
  total_cents bigint not null,
  tax_breakdown jsonb not null,
  shop_snapshot jsonb not null,
  unique (shop_id, invoice_number),
  unique (shop_id, id),
  foreign key (shop_id, ticket_id) references public.tickets (shop_id, id) on delete cascade,
  foreign key (shop_id, estimate_id) references public.estimates (shop_id, id) on delete cascade
);
create index invoices_shop_ticket_idx on public.invoices (shop_id, ticket_id);
create index invoices_issued_by_idx on public.invoices (issued_by);

---------------------------------------------------------------------------
-- Payments: recorded only, never processed. No card data.
---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  ticket_id uuid not null,
  kind public.payment_kind not null,
  method public.payment_method not null,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000),
  paid_on date not null,
  note text check (char_length(note) <= 500),
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null,
  unique (shop_id, id),
  foreign key (shop_id, ticket_id) references public.tickets (shop_id, id) on delete cascade
);
create index payments_shop_ticket_idx on public.payments (shop_id, ticket_id) where deleted_at is null;
create index payments_recorded_by_idx on public.payments (recorded_by);
create index payments_updated_by_idx on public.payments (updated_by);
create index payments_deleted_by_idx on public.payments (deleted_by);

-- Read-only for members; every write goes through the functions below.
do $$
declare
  t text;
begin
  foreach t in array array['estimates', 'estimate_line_items', 'invoices', 'payments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  foreach t in array array['estimates', 'estimate_line_items'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()', t || '_set_updated_at', t);
  end loop;
end;
$$;
create policy estimates_select_members on public.estimates for select to authenticated
  using (shop_id = any ((select private.my_shop_ids())::uuid[]));
create policy estimate_line_items_select_members on public.estimate_line_items for select to authenticated
  using (shop_id = any ((select private.my_shop_ids())::uuid[]));
create policy invoices_select_members on public.invoices for select to authenticated
  using (shop_id = any ((select private.my_shop_ids())::uuid[]));
create policy payments_select_members on public.payments for select to authenticated
  using (shop_id = any ((select private.my_shop_ids())::uuid[]) and deleted_at is null);

-- Catalog items used on any estimate can only be archived (spec §7.6).
create function private.guard_catalog_item_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.shops where id = old.shop_id)
     and exists (select 1 from public.estimate_line_items l where l.shop_id = old.shop_id and l.catalog_item_id = old.id) then
    raise exception 'this item is used on tickets. Archive it instead' using errcode = '22023';
  end if;
  return old;
end;
$$;
create trigger catalog_items_guard_delete before delete on public.catalog_items
  for each row execute function private.guard_catalog_item_delete();

---------------------------------------------------------------------------
-- Pure money helpers (tested directly in 008_money)
---------------------------------------------------------------------------
-- The shop's local calendar date at a moment (date-only fields use it).
create function private.shop_local_date(p_at timestamptz, p_time_zone text)
returns date
language sql
stable
set search_path = ''
as $$
  select (p_at at time zone p_time_zone)::date;
$$;

-- Both bounds inclusive, either may be open.
create function private.discount_active_on(p_starts date, p_ends date, p_on date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_starts is null or p_starts <= p_on) and (p_ends is null or p_ends >= p_on);
$$;

-- One line's money. p_clamp: a catalog fixed discount larger than a small
-- line is capped at the line; a manual one is rejected instead.
create function private.line_math(
  p_quantity numeric,
  p_unit_price_cents bigint,
  p_discount_type public.discount_type,
  p_discount_value numeric,
  p_clamp boolean,
  out subtotal_cents bigint,
  out discount_cents bigint,
  out total_cents bigint
)
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_quantity is null or p_quantity <= 0 or p_quantity > 10000 then
    raise exception 'quantity must be above 0' using errcode = '22023';
  end if;
  subtotal_cents := round(p_quantity * p_unit_price_cents)::bigint;
  discount_cents := case p_discount_type
    when 'percent' then round(subtotal_cents * p_discount_value / 100)::bigint
    when 'fixed' then round(p_discount_value * 100)::bigint
    else 0
  end;
  if discount_cents > subtotal_cents then
    if p_clamp then
      discount_cents := subtotal_cents;
    else
      raise exception 'the discount can''t be more than the line ($%)', to_char(subtotal_cents / 100.0, 'FM999999990.00')
        using errcode = '22023';
    end if;
  end if;
  total_cents := subtotal_cents - discount_cents;
end;
$$;

-- Recompute and store an estimate's totals from its lines (decision P2).
create function private.recalc_estimate(p_estimate_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_breakdown jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'name', r.name, 'rate', r.rate,
           'taxable_cents', r.taxable, 'tax_cents', round(r.taxable * r.rate / 100)::bigint)
         order by r.name), '[]'::jsonb)
    into v_breakdown
    from (
      select t ->> 'id' as id, t ->> 'name' as name, (t ->> 'rate')::numeric as rate, sum(l.line_total_cents) as taxable
        from public.estimate_line_items l
        cross join lateral jsonb_array_elements(l.tax_snapshot) t
       where l.estimate_id = p_estimate_id
       group by 1, 2, 3
    ) r;

  update public.estimates e set
    subtotal_before_cents = s.before,
    savings_cents = s.savings,
    subtotal_cents = s.after,
    tax_breakdown = v_breakdown,
    tax_cents = s.tax,
    total_cents = s.after + s.tax
  from (
    select coalesce(sum(l.line_subtotal_cents), 0) as before,
           coalesce(sum(l.discount_cents), 0) as savings,
           coalesce(sum(l.line_total_cents), 0) as after,
           (select coalesce(sum((b ->> 'tax_cents')::bigint), 0) from jsonb_array_elements(v_breakdown) b) as tax
      from public.estimate_line_items l
     where l.estimate_id = p_estimate_id
  ) s
  where e.id = p_estimate_id;
end;
$$;

-- Lock a draft estimate for editing and check the caller is a member.
create function private.editable_estimate(p_estimate_id uuid)
returns public.estimates
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.estimates;
begin
  select * into e from public.estimates where id = p_estimate_id for update;
  if not found or not private.has_role(e.shop_id, 'staff')
     or not exists (select 1 from public.tickets t where t.id = e.ticket_id and t.deleted_at is null) then
    raise exception 'estimate not found' using errcode = 'P0002';
  end if;
  if e.status <> 'draft' then
    raise exception 'this estimate was already sent or decided. Start a revision to change it' using errcode = '22023';
  end if;
  return e;
end;
$$;

create function private.require_admin(p_shop_id uuid, p_what text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_shop_id, 'admin') then
    raise exception 'only the owner or an admin can %', p_what using errcode = '42501';
  end if;
end;
$$;

---------------------------------------------------------------------------
-- Estimate RPCs
---------------------------------------------------------------------------
-- The ticket's current draft estimate, created (version 1, or next) if none.
create function public.start_estimate(p_ticket_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tickets;
  e public.estimates;
  v_id uuid;
  v_version integer;
begin
  select * into t from public.tickets where id = p_ticket_id and deleted_at is null for update;
  if not found or not private.has_role(t.shop_id, 'staff') then
    raise exception 'ticket not found' using errcode = 'P0002';
  end if;
  select * into e from public.estimates where ticket_id = t.id and status <> 'superseded';
  if found then
    if e.status = 'draft' then
      return e.id;
    end if;
    raise exception 'this ticket already has an estimate. Start a revision to change it' using errcode = '22023';
  end if;
  insert into public.estimates (shop_id, ticket_id, version, created_by)
  values (t.shop_id, t.id, coalesce((select max(version) from public.estimates where ticket_id = t.id), 0) + 1, (select auth.uid()))
  returning id, version into v_id, v_version;
  perform private.ticket_event(t.shop_id, t.id, 'estimate', jsonb_build_object('action', 'started', 'version', v_version));
  return v_id;
end;
$$;

-- A new draft version copying every line as is (snapshots kept, not re-priced).
-- The old version stays visible as "superseded" with its approval history.
create function public.revise_estimate(p_estimate_id uuid)
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
  insert into public.estimates (shop_id, ticket_id, version, created_by)
  values (e.shop_id, e.ticket_id, e.version + 1, (select auth.uid()))
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

-- Add a catalog item. Copies name, unit, price, active taxes and the discount
-- active today in the shop's time zone. A different unit price is an
-- override: Owner/Admin only, audited.
create function public.add_estimate_line(
  p_estimate_id uuid,
  p_catalog_item_id uuid,
  p_quantity numeric default 1,
  p_unit_price_cents bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.estimates := private.editable_estimate(p_estimate_id);
  c public.catalog_items;
  v_today date;
  v_price bigint;
  v_dtype public.discount_type;
  v_dvalue numeric;
  v_taxes jsonb;
  m record;
  v_id uuid;
begin
  select * into c from public.catalog_items where id = p_catalog_item_id and shop_id = e.shop_id and archived_at is null;
  if not found then
    raise exception 'catalog item not found' using errcode = 'P0002';
  end if;
  v_price := coalesce(p_unit_price_cents, c.price_cents);
  if v_price <> c.price_cents then
    perform private.require_admin(e.shop_id, 'change a price');
  end if;
  v_today := private.shop_local_date(now(), (select time_zone from public.shops where id = e.shop_id));
  if c.discount_type is not null and private.discount_active_on(c.discount_starts_on, c.discount_ends_on, v_today) then
    v_dtype := c.discount_type;
    v_dvalue := c.discount_value;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'rate', r.rate) order by r.name), '[]'::jsonb)
    into v_taxes
    from public.catalog_item_tax_rates x join public.tax_rates r on r.id = x.tax_rate_id
   where x.catalog_item_id = c.id and r.active;
  select * into m from private.line_math(coalesce(p_quantity, 1), v_price, v_dtype, v_dvalue, true);
  insert into public.estimate_line_items (shop_id, estimate_id, position, catalog_item_id, is_custom, name_snapshot,
    unit_snapshot, catalog_unit_price_cents, unit_price_cents, quantity, discount_type, discount_value, discount_source,
    tax_snapshot, line_subtotal_cents, discount_cents, line_total_cents, added_on, created_by)
  values (e.shop_id, e.id,
    coalesce((select max(position) from public.estimate_line_items where estimate_id = e.id), 0) + 1,
    c.id, false, c.name, c.unit, c.price_cents, v_price, coalesce(p_quantity, 1), v_dtype, v_dvalue,
    case when v_dtype is not null then 'catalog'::public.discount_source end,
    v_taxes, m.subtotal_cents, m.discount_cents, m.total_cents, v_today, (select auth.uid()))
  returning id into v_id;
  if v_price <> c.price_cents then
    perform private.audit(e.shop_id, 'estimate_line.price_override', 'estimate_line_items', v_id,
      jsonb_build_object('unit_price_cents', c.price_cents), jsonb_build_object('unit_price_cents', v_price, 'item', c.name));
  end if;
  perform private.recalc_estimate(e.id);
  return v_id;
end;
$$;

-- A one-off line (Owner/Admin), flagged custom and audited.
create function public.add_custom_line(
  p_estimate_id uuid,
  p_name text,
  p_quantity numeric,
  p_unit_price_cents bigint,
  p_tax_rate_ids uuid[] default '{}',
  p_unit public.catalog_unit default 'each'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.estimates := private.editable_estimate(p_estimate_id);
  v_taxes jsonb;
  m record;
  v_id uuid;
begin
  perform private.require_admin(e.shop_id, 'add a custom line');
  if p_unit_price_cents is null or p_unit_price_cents < 0 or p_unit_price_cents > 100000000 then
    raise exception 'enter a price' using errcode = '22023';
  end if;
  if p_quantity is not null and (p_quantity <= 0 or p_quantity > 10000) then
    raise exception 'quantity must be above 0' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_tax_rate_ids, '{}')) i
              where not exists (select 1 from public.tax_rates r where r.id = i and r.shop_id = e.shop_id)) then
    raise exception 'tax rate not found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'rate', r.rate) order by r.name), '[]'::jsonb)
    into v_taxes
    from public.tax_rates r where r.shop_id = e.shop_id and r.id = any (coalesce(p_tax_rate_ids, '{}'));
  select * into m from private.line_math(coalesce(p_quantity, 1), p_unit_price_cents, null, null, false);
  insert into public.estimate_line_items (shop_id, estimate_id, position, is_custom, name_snapshot, unit_snapshot,
    unit_price_cents, quantity, tax_snapshot, line_subtotal_cents, discount_cents, line_total_cents, added_on, created_by)
  values (e.shop_id, e.id,
    coalesce((select max(position) from public.estimate_line_items where estimate_id = e.id), 0) + 1,
    true, btrim(coalesce(p_name, '')), coalesce(p_unit, 'each'), p_unit_price_cents, coalesce(p_quantity, 1), v_taxes,
    m.subtotal_cents, m.discount_cents, m.total_cents,
    private.shop_local_date(now(), (select time_zone from public.shops where id = e.shop_id)), (select auth.uid()))
  returning id into v_id;
  perform private.audit(e.shop_id, 'estimate_line.custom_added', 'estimate_line_items', v_id, null,
    jsonb_build_object('name', btrim(p_name), 'quantity', p_quantity, 'unit_price_cents', p_unit_price_cents, 'taxes', v_taxes));
  perform private.recalc_estimate(e.id);
  return v_id;
end;
$$;

-- Change quantity (any member) and/or unit price (Owner/Admin, audited).
create function public.update_estimate_line(
  p_line_id uuid,
  p_quantity numeric default null,
  p_unit_price_cents bigint default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.estimate_line_items;
  e public.estimates;
  v_qty numeric;
  v_price bigint;
  m record;
begin
  select * into l from public.estimate_line_items where id = p_line_id;
  if not found then
    raise exception 'line not found' using errcode = 'P0002';
  end if;
  e := private.editable_estimate(l.estimate_id);
  v_qty := coalesce(p_quantity, l.quantity);
  v_price := coalesce(p_unit_price_cents, l.unit_price_cents);
  if v_price <> l.unit_price_cents then
    perform private.require_admin(e.shop_id, 'change a price');
  end if;
  select * into m from private.line_math(v_qty, v_price, l.discount_type, l.discount_value, l.discount_source = 'catalog');
  update public.estimate_line_items set quantity = v_qty, unit_price_cents = v_price,
    line_subtotal_cents = m.subtotal_cents, discount_cents = m.discount_cents, line_total_cents = m.total_cents
   where id = l.id;
  if v_price <> l.unit_price_cents then
    perform private.audit(e.shop_id, 'estimate_line.price_override', 'estimate_line_items', l.id,
      jsonb_build_object('unit_price_cents', l.unit_price_cents),
      jsonb_build_object('unit_price_cents', v_price, 'item', l.name_snapshot));
  end if;
  perform private.recalc_estimate(e.id);
end;
$$;

-- Set, change or remove (p_type null) the line's one discount. Owner/Admin.
create function public.set_line_discount(
  p_line_id uuid,
  p_type public.discount_type,
  p_value numeric,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.estimate_line_items;
  e public.estimates;
  m record;
begin
  select * into l from public.estimate_line_items where id = p_line_id;
  if not found then
    raise exception 'line not found' using errcode = 'P0002';
  end if;
  e := private.editable_estimate(l.estimate_id);
  perform private.require_admin(e.shop_id, 'change discounts');
  if p_type is not null then
    if p_value is null or p_value < 0 or (p_type = 'percent' and p_value > 100) then
      raise exception 'a percent discount is 0 to 100; an amount can''t be negative' using errcode = '22023';
    end if;
  end if;
  select * into m from private.line_math(l.quantity, l.unit_price_cents, p_type, case when p_type is not null then round(p_value, 2) end, false);
  update public.estimate_line_items set
    discount_type = p_type,
    discount_value = case when p_type is not null then round(p_value, 2) end,
    discount_source = case when p_type is not null then 'manual'::public.discount_source end,
    discount_reason = case when p_type is not null then nullif(btrim(coalesce(p_reason, '')), '') end,
    line_subtotal_cents = m.subtotal_cents, discount_cents = m.discount_cents, line_total_cents = m.total_cents
  where id = l.id;
  perform private.audit(e.shop_id, 'estimate_line.discount', 'estimate_line_items', l.id,
    jsonb_build_object('type', l.discount_type, 'value', l.discount_value, 'source', l.discount_source, 'reason', l.discount_reason),
    jsonb_build_object('type', p_type, 'value', p_value, 'reason', nullif(btrim(coalesce(p_reason, '')), ''), 'item', l.name_snapshot));
  perform private.recalc_estimate(e.id);
end;
$$;

create function public.remove_estimate_line(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.estimate_line_items;
  e public.estimates;
begin
  select * into l from public.estimate_line_items where id = p_line_id;
  if not found then
    raise exception 'line not found' using errcode = 'P0002';
  end if;
  e := private.editable_estimate(l.estimate_id);
  delete from public.estimate_line_items where id = l.id;
  perform private.audit(e.shop_id, 'estimate_line.removed', 'estimate_line_items', l.id, to_jsonb(l), null);
  perform private.recalc_estimate(e.id);
end;
$$;

-- draft -> sent; draft/sent -> approved (how it was given) or declined.
create function public.set_estimate_status(
  p_estimate_id uuid,
  p_status public.estimate_status,
  p_approval_method public.approval_method default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.estimates;
begin
  select * into e from public.estimates where id = p_estimate_id for update;
  if not found or not private.has_role(e.shop_id, 'staff')
     or not exists (select 1 from public.tickets t where t.id = e.ticket_id and t.deleted_at is null) then
    raise exception 'estimate not found' using errcode = 'P0002';
  end if;
  if not (
    (e.status = 'draft' and p_status = 'sent')
    or (e.status in ('draft', 'sent') and p_status in ('approved', 'declined'))
  ) then
    raise exception 'an estimate that is % can''t become %', e.status, p_status using errcode = '22023';
  end if;
  if p_status = 'approved' and p_approval_method is null then
    raise exception 'record how the customer approved' using errcode = '22023';
  end if;
  if p_status in ('sent', 'approved')
     and not exists (select 1 from public.estimate_line_items where estimate_id = e.id) then
    raise exception 'add at least one line first' using errcode = '22023';
  end if;
  update public.estimates set
    status = p_status,
    sent_at = case when p_status = 'sent' then now() else sent_at end,
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    approval_method = case when p_status = 'approved' then p_approval_method else approval_method end,
    declined_at = case when p_status = 'declined' then now() else declined_at end
  where id = e.id;
  perform private.audit(e.shop_id, 'estimate.' || p_status, 'estimates', e.id,
    jsonb_build_object('status', e.status),
    jsonb_build_object('status', p_status, 'approval_method', p_approval_method, 'total_cents', e.total_cents, 'version', e.version));
  perform private.ticket_event(e.shop_id, e.ticket_id, 'estimate',
    jsonb_build_object('action', p_status, 'version', e.version, 'total_cents', e.total_cents, 'approval_method', p_approval_method));
end;
$$;

---------------------------------------------------------------------------
-- Invoices
---------------------------------------------------------------------------
-- Issue from the current approved estimate. Earlier invoices for the ticket
-- are voided (a revision was approved since). Any member may issue.
create function public.issue_invoice(p_estimate_id uuid)
returns table (invoice_id uuid, invoice_number integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.estimates;
  s public.shops;
  v_number integer;
  v_id uuid;
begin
  select * into e from public.estimates where id = p_estimate_id for update;
  if not found or not private.has_role(e.shop_id, 'staff')
     or not exists (select 1 from public.tickets t where t.id = e.ticket_id and t.deleted_at is null) then
    raise exception 'estimate not found' using errcode = 'P0002';
  end if;
  if e.status <> 'approved' then
    raise exception 'only an approved estimate can be invoiced' using errcode = '22023';
  end if;
  if exists (select 1 from public.invoices i where i.estimate_id = e.id) then
    raise exception 'this estimate is already invoiced' using errcode = '23505';
  end if;
  update public.shops set next_invoice_number = next_invoice_number + 1
   where id = e.shop_id
   returning * into s;
  v_number := s.next_invoice_number - 1;
  update public.invoices set voided_at = now() where ticket_id = e.ticket_id and voided_at is null;
  insert into public.invoices (shop_id, ticket_id, estimate_id, invoice_number, issued_by, subtotal_before_cents,
    savings_cents, subtotal_cents, tax_cents, total_cents, tax_breakdown, shop_snapshot)
  values (e.shop_id, e.ticket_id, e.id, v_number, (select auth.uid()), e.subtotal_before_cents, e.savings_cents,
    e.subtotal_cents, e.tax_cents, e.total_cents, e.tax_breakdown,
    jsonb_build_object('name', s.name, 'address', s.address, 'phone', s.phone, 'email', s.email,
      'tax_registration_number', s.tax_registration_number, 'currency', s.currency, 'logo_path', s.logo_path))
  returning id into v_id;
  perform private.audit(e.shop_id, 'invoice.issued', 'invoices', v_id, null,
    jsonb_build_object('invoice_number', v_number, 'total_cents', e.total_cents, 'estimate_version', e.version));
  perform private.ticket_event(e.shop_id, e.ticket_id, 'estimate',
    jsonb_build_object('action', 'invoiced', 'invoice_number', v_number, 'total_cents', e.total_cents));
  return query select v_id, v_number;
end;
$$;

---------------------------------------------------------------------------
-- Payments
---------------------------------------------------------------------------
create function public.record_payment(
  p_ticket_id uuid,
  p_kind public.payment_kind,
  p_method public.payment_method,
  p_amount_cents bigint,
  p_paid_on date default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tickets;
  v_id uuid;
  v_on date;
begin
  select * into t from public.tickets where id = p_ticket_id and deleted_at is null;
  if not found or not private.has_role(t.shop_id, 'staff') then
    raise exception 'ticket not found' using errcode = 'P0002';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 100000000 then
    raise exception 'enter an amount above $0' using errcode = '22023';
  end if;
  v_on := coalesce(p_paid_on, private.shop_local_date(now(), (select time_zone from public.shops where id = t.shop_id)));
  insert into public.payments (shop_id, ticket_id, kind, method, amount_cents, paid_on, note, recorded_by, updated_by)
  values (t.shop_id, t.id, p_kind, p_method, p_amount_cents, v_on, nullif(btrim(coalesce(p_note, '')), ''),
    (select auth.uid()), (select auth.uid()))
  returning id into v_id;
  perform private.audit(t.shop_id, 'payment.recorded', 'payments', v_id, null,
    jsonb_build_object('kind', p_kind, 'method', p_method, 'amount_cents', p_amount_cents, 'paid_on', v_on));
  perform private.ticket_event(t.shop_id, t.id, 'payment',
    jsonb_build_object('action', 'recorded', 'kind', p_kind, 'method', p_method, 'amount_cents', p_amount_cents));
  return v_id;
end;
$$;

create function public.update_payment(
  p_payment_id uuid,
  p_kind public.payment_kind,
  p_method public.payment_method,
  p_amount_cents bigint,
  p_paid_on date,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payments;
begin
  select * into p from public.payments where id = p_payment_id and deleted_at is null for update;
  if not found or not private.has_role(p.shop_id, 'staff') then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  perform private.require_admin(p.shop_id, 'edit payments');
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 100000000 then
    raise exception 'enter an amount above $0' using errcode = '22023';
  end if;
  update public.payments set kind = p_kind, method = p_method, amount_cents = p_amount_cents,
    paid_on = coalesce(p_paid_on, paid_on), note = nullif(btrim(coalesce(p_note, '')), ''),
    updated_by = (select auth.uid()), updated_at = now()
  where id = p.id;
  perform private.audit(p.shop_id, 'payment.edited', 'payments', p.id,
    jsonb_build_object('kind', p.kind, 'method', p.method, 'amount_cents', p.amount_cents, 'paid_on', p.paid_on, 'note', p.note),
    jsonb_build_object('kind', p_kind, 'method', p_method, 'amount_cents', p_amount_cents, 'paid_on', coalesce(p_paid_on, p.paid_on), 'note', p_note));
  perform private.ticket_event(p.shop_id, p.ticket_id, 'payment',
    jsonb_build_object('action', 'edited', 'kind', p_kind, 'amount_cents', p_amount_cents));
end;
$$;

create function public.delete_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payments;
begin
  select * into p from public.payments where id = p_payment_id and deleted_at is null for update;
  if not found or not private.has_role(p.shop_id, 'staff') then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  perform private.require_admin(p.shop_id, 'delete payments');
  update public.payments set deleted_at = now(), deleted_by = (select auth.uid()) where id = p.id;
  perform private.audit(p.shop_id, 'payment.deleted', 'payments', p.id,
    jsonb_build_object('kind', p.kind, 'method', p.method, 'amount_cents', p.amount_cents, 'paid_on', p.paid_on, 'note', p.note), null);
  perform private.ticket_event(p.shop_id, p.ticket_id, 'payment',
    jsonb_build_object('action', 'deleted', 'kind', p.kind, 'amount_cents', p.amount_cents));
end;
$$;

---------------------------------------------------------------------------
-- Execute rights
---------------------------------------------------------------------------
revoke execute on function
  private.guard_catalog_item_delete(),
  private.shop_local_date(timestamptz, text),
  private.discount_active_on(date, date, date),
  private.line_math(numeric, bigint, public.discount_type, numeric, boolean),
  private.recalc_estimate(uuid),
  private.editable_estimate(uuid),
  private.require_admin(uuid, text),
  public.start_estimate(uuid),
  public.revise_estimate(uuid),
  public.add_estimate_line(uuid, uuid, numeric, bigint),
  public.add_custom_line(uuid, text, numeric, bigint, uuid[], public.catalog_unit),
  public.update_estimate_line(uuid, numeric, bigint),
  public.set_line_discount(uuid, public.discount_type, numeric, text),
  public.remove_estimate_line(uuid),
  public.set_estimate_status(uuid, public.estimate_status, public.approval_method),
  public.issue_invoice(uuid),
  public.record_payment(uuid, public.payment_kind, public.payment_method, bigint, date, text),
  public.update_payment(uuid, public.payment_kind, public.payment_method, bigint, date, text),
  public.delete_payment(uuid)
from public, anon, authenticated;
grant execute on function
  public.start_estimate(uuid),
  public.revise_estimate(uuid),
  public.add_estimate_line(uuid, uuid, numeric, bigint),
  public.add_custom_line(uuid, text, numeric, bigint, uuid[], public.catalog_unit),
  public.update_estimate_line(uuid, numeric, bigint),
  public.set_line_discount(uuid, public.discount_type, numeric, text),
  public.remove_estimate_line(uuid),
  public.set_estimate_status(uuid, public.estimate_status, public.approval_method),
  public.issue_invoice(uuid),
  public.record_payment(uuid, public.payment_kind, public.payment_method, bigint, date, text),
  public.update_payment(uuid, public.payment_kind, public.payment_method, bigint, date, text),
  public.delete_payment(uuid)
to authenticated;
