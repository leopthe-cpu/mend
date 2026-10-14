-- UX simplification PR 1 (docs/ux-simplification-plan.md, decision 67):
-- the catalog (the PRICE charged to customers) is managed by Admins (owner and
-- admin), not just the Owner. Team members (staff) stay read-only.
--
-- Internal cost / inventory is a future PRO feature (decision 66): the
-- catalog_item_costs table, its data and its Owner-only RLS are unchanged, and
-- save_catalog_item no longer reads or writes cost, so editing an item can
-- never wipe a cost.

-- 1) save_catalog_item: require 'admin', and stop touching the cost table.
--    (Same signature, so existing grants and the 002 allow-list are unchanged.)
create or replace function public.save_catalog_item(
  p_shop_id uuid,
  p_item_id uuid,
  p_name text,
  p_category text,
  p_item_type public.catalog_item_type,
  p_unit public.catalog_unit,
  p_price_cents bigint,
  p_sku text default null,
  p_discount_type public.discount_type default null,
  p_discount_value numeric default null,
  p_discount_starts_on date default null,
  p_discount_ends_on date default null,
  p_tax_rate_ids uuid[] default '{}',
  p_cost_cents bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_item_id;
begin
  if not private.has_role(p_shop_id, 'admin') then
    raise exception 'only an admin can change the catalog' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 120 then
    raise exception 'give the item a name (up to 120 characters)' using errcode = '22023';
  end if;
  if p_price_cents is null or p_price_cents < 0 or p_price_cents > 100000000 then
    raise exception 'enter a price' using errcode = '22023';
  end if;
  if p_discount_type is not null and (
       p_discount_value is null or p_discount_value < 0
       or (p_discount_type = 'percent' and p_discount_value > 100)) then
    raise exception 'a percent discount is 0 to 100; an amount can''t be negative' using errcode = '22023';
  end if;
  if p_discount_starts_on is not null and p_discount_ends_on is not null and p_discount_starts_on > p_discount_ends_on then
    raise exception 'the discount ends before it starts' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_tax_rate_ids, '{}')) i
              where not exists (select 1 from public.tax_rates r where r.id = i and r.shop_id = p_shop_id)) then
    raise exception 'tax rate not found' using errcode = 'P0002';
  end if;

  -- Internal cost is a future PRO feature (decision 66): this function never
  -- reads or writes catalog_item_costs, so saving an item can never wipe a cost.

  if v_id is null then
    insert into public.catalog_items (shop_id, name, category, item_type, unit, price_cents, sku,
      discount_type, discount_value, discount_starts_on, discount_ends_on)
    values (p_shop_id, btrim(p_name), nullif(btrim(coalesce(p_category, '')), ''), p_item_type, p_unit, p_price_cents,
      nullif(btrim(coalesce(p_sku, '')), ''), p_discount_type,
      case when p_discount_type is not null then round(p_discount_value, 2) end,
      case when p_discount_type is not null then p_discount_starts_on end,
      case when p_discount_type is not null then p_discount_ends_on end)
    returning id into v_id;
  else
    update public.catalog_items set
      name = btrim(p_name),
      category = nullif(btrim(coalesce(p_category, '')), ''),
      item_type = p_item_type,
      unit = p_unit,
      price_cents = p_price_cents,
      sku = nullif(btrim(coalesce(p_sku, '')), ''),
      discount_type = p_discount_type,
      discount_value = case when p_discount_type is not null then round(p_discount_value, 2) end,
      discount_starts_on = case when p_discount_type is not null then p_discount_starts_on end,
      discount_ends_on = case when p_discount_type is not null then p_discount_ends_on end
    where id = v_id and shop_id = p_shop_id;
    if not found then
      raise exception 'catalog item not found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.catalog_item_tax_rates
   where catalog_item_id = v_id and tax_rate_id <> all (coalesce(p_tax_rate_ids, '{}'));
  insert into public.catalog_item_tax_rates (shop_id, catalog_item_id, tax_rate_id)
  select p_shop_id, v_id, i from unnest(coalesce(p_tax_rate_ids, '{}')) i
  on conflict do nothing;

  return v_id;
end;
$$;

-- 2) Catalog writes open to Admins (owner + admin); staff stay read-only.
--    (catalog_item_costs keeps its Owner-only policy; see decision 66.)
do $$
declare
  t text;
begin
  foreach t in array array['catalog_items', 'catalog_item_tax_rates'] loop
    execute format('drop policy if exists %I on public.%I', t || '_insert_owner', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_owner', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_owner', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.has_role(shop_id, ''admin'')))', t || '_insert_admins', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.has_role(shop_id, ''admin''))) with check ((select private.has_role(shop_id, ''admin'')))', t || '_update_admins', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.has_role(shop_id, ''admin'')))', t || '_delete_admins', t);
  end loop;
end;
$$;