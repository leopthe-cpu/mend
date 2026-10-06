-- Phase 1B: onboarding (spec §5 "Signup flow", §7.1; decisions 17, 19).
-- One function creates the shop, the Owner membership and the vertical's
-- statuses, custom fields, message templates, tax rates and starter catalog in
-- a single transaction: any failure rolls everything back, so there is never a
-- half-made shop (addendum §8). The client never writes its own membership.

-- Friendly, positive name for owners who skip the shop name (decision 17).
create function private.generate_shop_name()
returns text
language sql
volatile
set search_path = ''
as $$
  select (array['Happy', 'Sunny', 'Bright', 'Cheerful', 'Lucky', 'Golden', 'Friendly', 'Jolly',
                'Merry', 'Clever', 'Cozy', 'Shiny', 'Brave', 'Gentle', 'Beautiful', 'Kind'])[1 + floor(random() * 16)::int]
      || ' '
      || (array['Shop', 'Workshop', 'Fix Shop', 'Repair Shop', 'Studio', 'Workbench'])[1 + floor(random() * 6)::int];
$$;

create function private.seed_vertical(p_shop_id uuid, p_vertical public.shop_vertical)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_statuses jsonb;
  v_fields jsonb;
  v_catalog jsonb;
  v_ready uuid;
  s jsonb;
  i integer := 0;
begin
  -- [name, category, color, is_final]
  v_statuses := case p_vertical
    when 'electronics' then '[["Received","open","received",false],["Diagnosing","open","in-progress",false],["Awaiting approval","waiting","waiting",false],["Awaiting parts","waiting","waiting",false],["In repair","open","in-progress",false],["Ready","ready","ready",false],["Picked up","closed","closed",true]]'
    when 'ski' then '[["Received","open","received",false],["In service","open","in-progress",false],["Ready","ready","ready",false],["Picked up","closed","closed",true]]'
    when 'tailoring' then '[["Received","open","received",false],["Fitting","open","in-progress",false],["In progress","open","in-progress",false],["Ready","ready","ready",false],["Picked up","closed","closed",true]]'
    else '[["Received","open","received",false],["In progress","open","in-progress",false],["Ready","ready","ready",false],["Picked up","closed","closed",true]]'
  end::jsonb;
  for s in select * from jsonb_array_elements(v_statuses) loop
    i := i + 1;
    insert into public.statuses (shop_id, name, position, category, color, notify_by_default, is_final)
    values (p_shop_id, s ->> 0, i, (s ->> 1)::public.status_category, s ->> 2, (s ->> 1) = 'ready', (s ->> 3)::boolean);
  end loop;

  select id into v_ready from public.statuses where shop_id = p_shop_id and category = 'ready' limit 1;
  insert into public.message_templates (shop_id, status_id, channel, subject, body) values
    (p_shop_id, v_ready, 'sms', null,
     'Hi {customer_name}, your {item_name} is ready for pickup at {shop_name}. {pickup_hours}'),
    (p_shop_id, v_ready, 'email', 'Your {item_name} is ready for pickup',
     'Hi {customer_name}, your {item_name} is ready for pickup at {shop_name}. {pickup_hours}');

  -- [label, type, options, help_text]
  v_fields := case p_vertical
    when 'electronics' then '[["Device model","text",[],null],["Serial or IMEI","text",[],null]]'
    when 'ski' then '[["Equipment type","select",["Skis","Snowboard","Boots","Other"],null],["Length","number",[],"In cm"],["Boot sole length","number",[],"In mm"],["Binding settings","text",[],"Recorded for reference only. The shop is responsible for safety settings."]]'
    when 'tailoring' then '[["Garment type","text",[],null],["Measurements","text",[],null],["Fitting date","date",[],null]]'
    else '[]'
  end::jsonb;
  i := 0;
  for s in select * from jsonb_array_elements(v_fields) loop
    i := i + 1;
    insert into public.custom_field_definitions (shop_id, label, field_type, options, position, help_text)
    values (p_shop_id, s ->> 0, (s ->> 1)::public.custom_field_type, s -> 2, i, s ->> 3);
  end loop;

  -- [name, item_type, unit]; prices start at 0 for the Owner to fill in.
  v_catalog := case p_vertical
    when 'electronics' then '[["Screen replacement","service","each"],["Battery replacement","service","each"],["Screen protector","part","each"],["Diagnostic","service","each"],["Labor","labor","hour"]]'
    when 'ski' then '[["Base wax","service","each"],["Full tune","service","each"],["Edge sharpening","service","each"],["Binding mount","service","each"],["Labor","labor","hour"]]'
    when 'tailoring' then '[["Hem pants","service","each"],["Take in waist","service","each"],["Zipper replacement","service","each"],["Dry clean","service","each"],["Labor","labor","hour"]]'
    else '[["Labor","labor","hour"]]'
  end::jsonb;
  for s in select * from jsonb_array_elements(v_catalog) loop
    insert into public.catalog_items (shop_id, name, item_type, unit, price_cents)
    values (p_shop_id, s ->> 0, (s ->> 1)::public.catalog_item_type, (s ->> 2)::public.catalog_unit, 0);
  end loop;
end;
$$;

create function public.create_shop(
  p_name text default null,
  p_full_name text default null,
  p_vertical public.shop_vertical default 'other',
  p_country text default 'CA',
  p_currency text default null,
  p_time_zone text default 'America/Toronto',
  p_address text default null,
  p_phone text default null,
  p_email text default null,
  p_business_hours jsonb default '{}'::jsonb,
  p_tax_rates jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_shop uuid;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_rate jsonb;
  v_tax uuid;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
    raise exception 'please confirm your email first' using errcode = '42501';
  end if;
  -- MVP: one shop per user (the data model allows more later).
  if exists (select 1 from public.memberships m where m.user_id = v_uid) then
    raise exception 'you already belong to a shop' using errcode = '23505';
  end if;
  if jsonb_typeof(coalesce(p_tax_rates, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_tax_rates, '[]'::jsonb)) > 5 then
    raise exception 'tax_rates must be a list of up to 5 rates' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_business_hours, '{}'::jsonb)) <> 'object' then
    raise exception 'business_hours must be an object' using errcode = '22023';
  end if;

  insert into public.shops (name, vertical, country, currency, time_zone, address, phone, email, business_hours, created_by)
  values (
    coalesce(v_name, private.generate_shop_name()),
    coalesce(p_vertical, 'other'),
    p_country,
    coalesce(p_currency, case p_country when 'US' then 'USD' else 'CAD' end),
    p_time_zone,
    nullif(btrim(p_address), ''),
    nullif(btrim(p_phone), ''),
    nullif(lower(btrim(p_email)), ''),
    coalesce(p_business_hours, '{}'::jsonb),
    v_uid
  )
  returning id into v_shop;

  insert into public.memberships (shop_id, user_id, role) values (v_shop, v_uid, 'owner');

  if nullif(btrim(coalesce(p_full_name, '')), '') is not null then
    update public.profiles set full_name = left(btrim(p_full_name), 200) where user_id = v_uid;
  end if;

  for v_rate in select * from jsonb_array_elements(coalesce(p_tax_rates, '[]'::jsonb)) loop
    insert into public.tax_rates (shop_id, name, rate)
    values (v_shop, btrim(v_rate ->> 'name'), (v_rate ->> 'rate')::numeric)
    returning id into v_tax;
  end loop;

  perform private.seed_vertical(v_shop, coalesce(p_vertical, 'other'));

  -- Starter catalog items carry every tax rate entered at onboarding.
  insert into public.catalog_item_tax_rates (shop_id, catalog_item_id, tax_rate_id)
  select v_shop, c.id, t.id
    from public.catalog_items c cross join public.tax_rates t
   where c.shop_id = v_shop and t.shop_id = v_shop;

  perform private.audit(v_shop, 'shop.created', 'shops', v_shop, null,
    jsonb_build_object('name', (select name from public.shops where id = v_shop), 'vertical', p_vertical));
  return v_shop;
end;
$$;

revoke execute on function private.generate_shop_name(), private.seed_vertical(uuid, public.shop_vertical)
  from public, anon, authenticated;
revoke execute on function public.create_shop(text, text, public.shop_vertical, text, text, text, text, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_shop(text, text, public.shop_vertical, text, text, text, text, text, text, jsonb, jsonb)
  to authenticated;
