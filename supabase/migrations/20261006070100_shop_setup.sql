-- Onboarding in the app (decision 53). Signup is now email + password +
-- confirmation only. On first entry the app creates the shop with defaults
-- (create_shop, unchanged: generated name, trade "other"), and the Owner
-- finishes setup inside the app with finish_shop_setup() below. Until they do,
-- shops.setup_completed_at is null and the app shows a "finish setting up" card.

alter table public.shops add column setup_completed_at timestamptz;
-- Shops created before this change went through the old setup wizard.
update public.shops set setup_completed_at = created_at where setup_completed_at is null;
-- Not in the column grants: only finish_shop_setup() sets it.

---------------------------------------------------------------------------
-- Trade starter data in one place, so first seeding and a later trade change
-- use the same lists. The four original trades are unchanged from
-- 20261006014337_onboarding.sql.
--   statuses: [name, category, color, is_final]; the final one is last
--   fields:   [label, type, options, help_text]
--   catalog:  [name, item_type, unit]; prices start at 0 for the Owner
---------------------------------------------------------------------------
create function private.trade_seed(p_vertical public.shop_vertical)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  -- Compared as text: the new enum values are added in the previous migration
  -- and can't be referenced as enum literals while it may share a transaction.
  return case p_vertical::text
    when 'electronics' then '{
      "statuses": [["Received","open","received",false],["Diagnosing","open","in-progress",false],["Awaiting approval","waiting","waiting",false],["Awaiting parts","waiting","waiting",false],["In repair","open","in-progress",false],["Ready","ready","ready",false],["Picked up","closed","closed",true]],
      "fields": [["Device model","text",[],null],["Serial or IMEI","text",[],null]],
      "catalog": [["Screen replacement","service","each"],["Battery replacement","service","each"],["Screen protector","part","each"],["Diagnostic","service","each"],["Labor","labor","hour"]]}'
    when 'ski' then '{
      "statuses": [["Received","open","received",false],["In service","open","in-progress",false],["Ready","ready","ready",false],["Picked up","closed","closed",true]],
      "fields": [["Equipment type","select",["Skis","Snowboard","Boots","Other"],null],["Length","number",[],"In cm"],["Boot sole length","number",[],"In mm"],["Binding settings","text",[],"Recorded for reference only. The shop is responsible for safety settings."]],
      "catalog": [["Base wax","service","each"],["Full tune","service","each"],["Edge sharpening","service","each"],["Binding mount","service","each"],["Labor","labor","hour"]]}'
    when 'tailoring' then '{
      "statuses": [["Received","open","received",false],["Fitting","open","in-progress",false],["In progress","open","in-progress",false],["Ready","ready","ready",false],["Picked up","closed","closed",true]],
      "fields": [["Garment type","text",[],null],["Measurements","text",[],null],["Fitting date","date",[],null]],
      "catalog": [["Hem pants","service","each"],["Take in waist","service","each"],["Zipper replacement","service","each"],["Dry clean","service","each"],["Labor","labor","hour"]]}'
    when 'shoe_leather' then '{
      "statuses": [["Received","open","received",false],["Awaiting approval","waiting","waiting",false],["In repair","open","in-progress",false],["Ready","ready","ready",false],["Picked up","closed","closed",true]],
      "fields": [["Item type","select",["Shoes","Boots","Bag","Belt","Jacket","Other"],null],["Colour","text",[],null],["Size","text",[],null]],
      "catalog": [["Full resole","service","each"],["Half sole","service","each"],["Heel replacement","service","each"],["Stitching repair","service","each"],["Zipper replacement","service","each"],["Clean and polish","service","each"],["Leather conditioning","service","each"],["Labor","labor","hour"]]}'
    when 'watch' then '{
      "statuses": [["Received","open","received",false],["Diagnosing","open","in-progress",false],["Awaiting approval","waiting","waiting",false],["Awaiting parts","waiting","waiting",false],["In repair","open","in-progress",false],["Testing","open","in-progress",false],["Ready","ready","ready",false],["Picked up","closed","closed",true]],
      "fields": [["Brand","text",[],null],["Model or reference","text",[],null],["Serial number","text",[],null],["Movement","select",["Quartz","Automatic","Manual wind","Other"],null]],
      "catalog": [["Battery replacement","service","each"],["Strap replacement","service","each"],["Bracelet sizing","service","each"],["Crystal replacement","service","each"],["Water resistance test","service","each"],["Full service","service","each"],["Labor","labor","hour"]]}'
    else '{
      "statuses": [["Received","open","received",false],["In progress","open","in-progress",false],["Ready","ready","ready",false],["Picked up","closed","closed",true]],
      "fields": [],
      "catalog": [["Labor","labor","hour"]]}'
  end::jsonb;
end;
$$;

-- Insert a trade's statuses (all, or all but the final one), custom fields,
-- "Ready" templates and catalog items. Catalog items whose name the shop
-- already has are skipped (e.g. "Labor" when switching trades).
create function private.insert_trade_seed(p_shop_id uuid, p_vertical public.shop_vertical, p_skip_final boolean)
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

-- Same name and behaviour as before (create_shop calls it), now driven by
-- trade_seed().
create or replace function private.seed_vertical(p_shop_id uuid, p_vertical public.shop_vertical)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.insert_trade_seed(p_shop_id, p_vertical, false);
end;
$$;

-- Swap one trade's starter setup for another's. Only called by
-- finish_shop_setup, and only while the shop has no tickets, so nothing in use
-- is removed. The final "Picked up" status is kept (it can't be deleted or
-- moved, decision 33) and placed last. Starter catalog items from the old trade
-- go only if still untouched (price 0, never archived); anything the shop
-- added or priced stays.
create function private.reseed_trade(p_shop_id uuid, p_old public.shop_vertical, p_new public.shop_vertical)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_items text[];
begin
  select coalesce(array_agg(x ->> 0), '{}') into v_old_items
    from jsonb_array_elements(private.trade_seed(p_old) -> 'catalog') x;

  delete from public.statuses where shop_id = p_shop_id and not is_final; -- templates cascade
  delete from public.custom_field_definitions where shop_id = p_shop_id;
  delete from public.catalog_items
   where shop_id = p_shop_id and price_cents = 0 and archived_at is null and name = any (v_old_items);

  perform private.insert_trade_seed(p_shop_id, p_new, true);
  update public.statuses
     set position = jsonb_array_length(private.trade_seed(p_new) -> 'statuses')
   where shop_id = p_shop_id and is_final;
end;
$$;

---------------------------------------------------------------------------
-- finish_shop_setup: the in-app setup screen saves everything in one
-- transaction (addendum §8). Owner or Admin, once per shop; later changes go
-- through Settings. The trade can only change while the shop has no tickets
-- (deleted ones included, they're kept for the audit trail).
---------------------------------------------------------------------------
create function public.finish_shop_setup(
  p_shop_id uuid,
  p_name text default null,
  p_full_name text default null,
  p_vertical public.shop_vertical default null,
  p_country text default null,
  p_time_zone text default null,
  p_address text default null,
  p_phone text default null,
  p_business_hours jsonb default null,
  p_tax_rates jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_shop public.shops;
  v_rate jsonb;
  v_tax uuid;
begin
  if v_uid is null or not private.has_role(p_shop_id, 'admin') then
    raise exception 'only the owner or an admin can set up the shop' using errcode = '42501';
  end if;
  select * into v_shop from public.shops where id = p_shop_id for update;
  if v_shop.setup_completed_at is not null then
    raise exception 'setup is already finished. Use Settings to make changes' using errcode = '22023';
  end if;
  if p_country is not null and p_country not in ('CA', 'US') then
    raise exception 'country must be CA or US' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_tax_rates, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_tax_rates, '[]'::jsonb))
        + (select count(*) from public.tax_rates r where r.shop_id = p_shop_id) > 5 then
    raise exception 'a shop can have up to 5 tax rates' using errcode = '22023';
  end if;
  if p_business_hours is not null and jsonb_typeof(p_business_hours) <> 'object' then
    raise exception 'business_hours must be an object' using errcode = '22023';
  end if;

  if p_vertical is not null and p_vertical is distinct from v_shop.vertical then
    if exists (select 1 from public.tickets t where t.shop_id = p_shop_id) then
      raise exception 'the trade can''t change once the shop has tickets. Adjust statuses and fields in Settings instead'
        using errcode = '22023';
    end if;
    perform private.reseed_trade(p_shop_id, v_shop.vertical, p_vertical);
  end if;

  update public.shops set
    name = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
    vertical = coalesce(p_vertical, vertical),
    country = coalesce(p_country, country),
    currency = case when p_country is null then currency when p_country = 'US' then 'USD' else 'CAD' end,
    time_zone = coalesce(p_time_zone, time_zone),
    address = case when p_address is null then address else nullif(btrim(p_address), '') end,
    phone = case when p_phone is null then phone else nullif(btrim(p_phone), '') end,
    business_hours = coalesce(p_business_hours, business_hours),
    setup_completed_at = now()
  where id = p_shop_id;

  if nullif(btrim(coalesce(p_full_name, '')), '') is not null then
    update public.profiles set full_name = left(btrim(p_full_name), 200) where user_id = v_uid;
  end if;

  -- New tax rates apply to every catalog item, as at onboarding.
  for v_rate in select * from jsonb_array_elements(coalesce(p_tax_rates, '[]'::jsonb)) loop
    insert into public.tax_rates (shop_id, name, rate)
    values (p_shop_id, btrim(v_rate ->> 'name'), (v_rate ->> 'rate')::numeric)
    returning id into v_tax;
    insert into public.catalog_item_tax_rates (shop_id, catalog_item_id, tax_rate_id)
    select p_shop_id, c.id, v_tax from public.catalog_items c where c.shop_id = p_shop_id;
  end loop;

  perform private.audit(p_shop_id, 'shop.setup_finished', 'shops', p_shop_id, null,
    jsonb_build_object('vertical', coalesce(p_vertical, v_shop.vertical)));
end;
$$;

---------------------------------------------------------------------------
-- onboarding_state: lets the app decide whether it may create a shop on its
-- own. It must not when the person was invited (a confirmation link opened in
-- another browser lands them here before the invite) or used to be on a team
-- (staff join only through invites, so a used invite means they were removed
-- since). Then the app asks instead. Only the caller's own data: invites sent
-- to their confirmed email, which the invite email already told them about.
---------------------------------------------------------------------------
create function public.onboarding_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'pending_invites', coalesce((
      select jsonb_agg(jsonb_build_object('shop_name', s.name, 'role', i.role) order by i.created_at desc)
        from public.invites i join public.shops s on s.id = i.shop_id
       where i.email = private.my_email()
         and i.used_at is null and i.revoked_at is null and i.expires_at > now()
         and exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null)
    ), '[]'::jsonb),
    'was_member', exists (select 1 from public.invites i where i.used_by = v_uid)
  );
end;
$$;

revoke execute on function private.trade_seed(public.shop_vertical),
  private.insert_trade_seed(uuid, public.shop_vertical, boolean),
  private.reseed_trade(uuid, public.shop_vertical, public.shop_vertical)
  from public, anon, authenticated;
revoke execute on function public.finish_shop_setup(uuid, text, text, public.shop_vertical, text, text, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.finish_shop_setup(uuid, text, text, public.shop_vertical, text, text, text, text, jsonb, jsonb)
  to authenticated;
revoke execute on function public.onboarding_state() from public, anon, authenticated;
grant execute on function public.onboarding_state() to authenticated;
