-- Phase 1B: per-shop configuration seeded by onboarding (spec §6, §7.1).
-- Board statuses, custom ticket fields, message templates, tax rates and the
-- catalog. Their editing screens arrive in later phases, but the tables, RLS
-- and audit exist now so onboarding can seed them in one transaction.
--
-- Cross-shop integrity: child rows reference parents through (shop_id, id), so
-- a row can never point at another shop's status, item or tax rate.

create type public.status_category as enum ('open', 'waiting', 'ready', 'closed');
create type public.custom_field_type as enum ('text', 'number', 'date', 'select');
create type public.message_channel as enum ('sms', 'email');
create type public.catalog_item_type as enum ('part', 'labor', 'service');
create type public.catalog_unit as enum ('each', 'hour');
create type public.discount_type as enum ('percent', 'fixed');

create table public.statuses (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  position integer not null,
  category public.status_category not null,
  color text not null default 'received' check (color in ('received', 'in-progress', 'waiting', 'ready', 'closed')),
  notify_by_default boolean not null default false,
  is_final boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, id)
);
create index statuses_shop_position_idx on public.statuses (shop_id, position);
-- One final ("Picked up") status per shop.
create unique index statuses_one_final_per_shop on public.statuses (shop_id) where is_final;

create table public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 60),
  field_type public.custom_field_type not null default 'text',
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  required boolean not null default false,
  position integer not null,
  help_text text check (char_length(help_text) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index custom_field_definitions_shop_idx on public.custom_field_definitions (shop_id, position);

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  status_id uuid not null,
  channel public.message_channel not null,
  subject text check (char_length(subject) <= 200),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (status_id, channel),
  foreign key (shop_id, status_id) references public.statuses (shop_id, id) on delete cascade
);
create index message_templates_shop_idx on public.message_templates (shop_id);

create table public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  rate numeric(6, 3) not null check (rate >= 0 and rate <= 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, id)
);
create index tax_rates_shop_idx on public.tax_rates (shop_id);

create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  category text check (char_length(category) <= 60),
  item_type public.catalog_item_type not null,
  unit public.catalog_unit not null default 'each',
  price_cents bigint not null default 0 check (price_cents >= 0),
  sku text check (char_length(sku) <= 60),
  discount_type public.discount_type,
  discount_value numeric(12, 2),
  discount_starts_on date,
  discount_ends_on date,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, id),
  -- A discount is all-or-nothing, sane, and its date range is ordered.
  check ((discount_type is null) = (discount_value is null)),
  check (discount_type is distinct from 'percent' or discount_value between 0 and 100),
  check (discount_type is distinct from 'fixed' or discount_value >= 0),
  check (discount_starts_on is null or discount_ends_on is null or discount_starts_on <= discount_ends_on)
);
create index catalog_items_shop_idx on public.catalog_items (shop_id);

-- Addendum §7 proposal P9 (accepted): join table instead of tax_rate_ids[].
create table public.catalog_item_tax_rates (
  shop_id uuid not null,
  catalog_item_id uuid not null,
  tax_rate_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (catalog_item_id, tax_rate_id),
  foreign key (shop_id, catalog_item_id) references public.catalog_items (shop_id, id) on delete cascade,
  foreign key (shop_id, tax_rate_id) references public.tax_rates (shop_id, id) on delete cascade
);
create index catalog_item_tax_rates_shop_idx on public.catalog_item_tax_rates (shop_id);

do $$
declare
  t text;
begin
  foreach t in array array['statuses', 'custom_field_definitions', 'message_templates', 'tax_rates', 'catalog_items'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()', t || '_set_updated_at', t);
  end loop;
  foreach t in array array['statuses', 'custom_field_definitions', 'message_templates', 'tax_rates', 'catalog_items', 'catalog_item_tax_rates'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    -- Every change is audited with old and new values (spec §4).
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row_change()', t || '_audit', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (shop_id = any ((select private.my_shop_ids())::uuid[]))',
      t || '_select_members', t);
  end loop;
  -- Shop settings: Owner and Admin (permissions matrix).
  foreach t in array array['statuses', 'custom_field_definitions', 'message_templates', 'tax_rates'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.has_role(shop_id, ''admin'')))', t || '_insert_admins', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.has_role(shop_id, ''admin''))) with check ((select private.has_role(shop_id, ''admin'')))', t || '_update_admins', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.has_role(shop_id, ''admin'')))', t || '_delete_admins', t);
  end loop;
  -- Catalog: Owner only (permissions matrix).
  foreach t in array array['catalog_items', 'catalog_item_tax_rates'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.has_role(shop_id, ''owner'')))', t || '_insert_owner', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.has_role(shop_id, ''owner''))) with check ((select private.has_role(shop_id, ''owner'')))', t || '_update_owner', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.has_role(shop_id, ''owner'')))', t || '_delete_owner', t);
  end loop;
end;
$$;
