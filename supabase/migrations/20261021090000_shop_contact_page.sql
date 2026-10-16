-- Sender identification for texts (decision 76; docs/legal-compliance.md
-- §3.3). CASL needs the sender's name, mailing address and one contact method
-- (phone, email or web address). Mend texts carry the shop name; the rest
-- lives on a public shop contact page, linked from the first text with the
-- opt-out notice. Oz chose address + phone as required.
--
-- 1. shops.public_code: random, unguessable code for /s/<code>.
-- 2. public.shop_contact(code): the only shop data anyone can read without
--    signing in: name, address, phone, email, hours text.
-- 3. private.app_settings: the public base URL for links built in the
--    database (production by default; change when the custom domain is set,
--    launch plan L5).
-- 4. The texts trigger (decision 74) now refuses texts until the shop has an
--    address and a phone, and adds the contact link to the opt-out notice.

alter table public.shops
  add column public_code text unique check (public_code ~ '^[0-9a-f]{10}$');
update public.shops set public_code = encode(extensions.gen_random_bytes(5), 'hex') where public_code is null;
alter table public.shops
  alter column public_code set not null,
  alter column public_code set default encode(extensions.gen_random_bytes(5), 'hex');
-- Server-managed like the counters: not part of the client's column grants.

create table private.app_settings (
  key text primary key,
  value text not null
);
alter table private.app_settings enable row level security;
insert into private.app_settings (key, value)
  values ('public_base_url', 'https://mend-production-2e99.up.railway.app');

create function public.shop_contact(p_code text)
returns table (name text, address text, phone text, email text, hours text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.name, s.address, s.phone, s.email, nullif(s.business_hours ->> 'text', '')
    from public.shops s
   where s.public_code = lower(btrim(p_code));
$$;
revoke execute on function public.shop_contact(text) from public, anon, authenticated;
grant execute on function public.shop_contact(text) to anon, authenticated;

create or replace function private.sms_stop_notice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shops;
  v_notice text;
begin
  if new.channel <> 'sms' then
    return new;
  end if;
  select * into s from public.shops where id = new.shop_id;
  if nullif(btrim(coalesce(s.address, '')), '') is null or nullif(btrim(coalesce(s.phone, '')), '') is null then
    raise exception 'add your shop''s address and phone in Settings → Shop before texting customers'
      using errcode = '22023';
  end if;
  if new.body ~* '\mstop\M' then
    return new;
  end if;
  if exists (
    select 1 from public.messages m
     where m.shop_id = new.shop_id and m.customer_id = new.customer_id and m.channel = 'sms'
       and m.status not in ('canceled', 'failed') and m.body ~* '\mstop\M'
  ) then
    return new;
  end if;
  v_notice := 'Reply STOP to opt out. Shop info: '
    || (select value from private.app_settings where key = 'public_base_url') || '/s/' || s.public_code;
  if char_length(btrim(new.body)) + 1 + char_length(v_notice) <= 1600 then
    new.body := btrim(new.body) || ' ' || v_notice;
  end if;
  return new;
end;
$$;
