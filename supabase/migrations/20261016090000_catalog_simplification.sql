-- UX simplification PR 4 (docs/ux-simplification-plan.md, 15 Oct):
-- catalog items are only "Service" and "Part". Existing labour items become
-- services, the trade starter seeds stop creating labour items, and
-- save_catalog_item refuses labour from now on. The `labor` enum value is
-- kept so old rows and the tests that insert labour directly still work.

-- 1) Existing rows: labour -> service (the "per hour" unit column is kept).
update public.catalog_items set item_type = 'service' where item_type = 'labor';

-- 2) Starter seeds: the shared "Labor" item is a Service sold per hour.
create or replace function private.trade_seed(p_vertical public.shop_vertical)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  return case p_vertical::text
    when 'electronics' then '{
      "statuses": [["Received","open","received",false],["Diagnosing","open","in-progress",false],["Awaiting approval","waiting","waiting",false],["Awaiting parts","waiting","waiting",false],["In repair","open","in-progress",false],["Ready","ready","ready",false],["Picked up","closed","closed",true]],
      "fields": [["Device model","text",[],null],["Serial or IMEI","text",[],null]],
      "catalog": [["Screen replacement","service","each"],["Battery replacement","service","each"],["Screen protector","part","each"],["Diagnostic","service","each"],["Labor","service","hour"]]}'
    when 'ski' then '{
      "statuses": [["Received","open","received",false],["In service","open","in-progress",false],["Ready","ready","ready",false],["Picked up","closed","closed",true]],
      "fields": [["Equipment type","select",["Skis","Snowboard","Boots","Other"],null],["Length","number",[],"In cm"],["Boot sole length","number",[],"In mm"],["Binding settings","text",[],"Recorded for reference only. The shop is responsible for safety settings."]],
      "catalog": [["Base wax","service","each"],["Full tune","service","each"],["Edge sharpening","service","each"],["Binding mount","service","each"],["Labor","service","hour"]]}'
    when 'tailoring' then '{
      "statuses": [["Received","open","received",false],["Fitting","open","in-progress",false],["In progress","open","in-progress",false],["Ready","ready","ready",false],["Picked up","closed","closed",true]],
      "fields": [["Garment type","text",[],null],["Measurements","text",[],null],["Fitting date","date",[],null]],
      "catalog": [["Hem pants","service","each"],["Take in waist","service","each"],["Zipper replacement","service","each"],["Dry clean","service","each"],["Labor","service","hour"]]}'
    when 'shoe_leather' then '{
      "statuses": [["Received","open","received",false],["Awaiting approval","waiting","waiting",false],["In repair","open","in-progress",false],["Ready","ready","ready",false],["Picked up","closed","closed",true]],
      "fields": [["Item type","select",["Shoes","Boots","Bag","Belt","Jacket","Other"],null],["Colour","text",[],null],["Size","text",[],null]],
      "catalog": [["Full resole","service","each"],["Half sole","service","each"],["Heel replacement","service","each"],["Stitching repair","service","each"],["Zipper replacement","service","each"],["Clean and polish","service","each"],["Leather conditioning","service","each"],["Labor","service","hour"]]}'
    when 'watch' then '{
      "statuses": [["Received","open","received",false],["Diagnosing","open","in-progress",false],["Awaiting approval","waiting","waiting",false],["Awaiting parts","waiting","waiting",false],["In repair","open","in-progress",false],["Testing","open","in-progress",false],["Ready","ready","ready",false],["Picked up","closed","closed",true]],
      "fields": [["Brand","text",[],null],["Model or reference","text",[],null],["Serial number","text",[],null],["Movement","select",["Quartz","Automatic","Manual wind","Other"],null]],
      "catalog": [["Battery replacement","service","each"],["Strap replacement","service","each"],["Bracelet sizing","service","each"],["Crystal replacement","service","each"],["Water resistance test","service","each"],["Full service","service","each"],["Labor","service","hour"]]}'
    else '{
      "statuses": [["Received","open","received",false],["In progress","open","in-progress",false],["Ready","ready","ready",false],["Picked up","closed","closed",true]],
      "fields": [],
      "catalog": [["Labor","service","hour"]]}'
  end::jsonb;
end;
$$;

-- 3) save_catalog_item: same signature (so grants and the 002 allow-list stay
--    valid), same Admin check, plus labour is refused.
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
  if p_item_type = 'labor' then
    raise exception 'labor is no longer a catalog type; use service' using errcode = '22023';
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
