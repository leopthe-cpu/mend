-- Phase 5: shop logo (spec §4 "Storage (intake photos, logos)", §7.12;
-- decision 57). Private bucket, path <shop_id>/<random>.png|jpg, 2 MB, PNG or
-- JPEG only (the PDF engine reads only those). Members can read it (PDFs, the
-- app); Owner/Admin upload and delete. shops.logo_path is set only through
-- set_shop_logo(), which checks the file is this shop's and exists; the
-- shops row-change audit trigger records the change.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop-logos', 'shop-logos', false, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;

create policy "shop-logos: members read" on storage.objects
  for select to authenticated
  using (bucket_id = 'shop-logos' and (storage.foldername(name))[1] = any ((select private.my_shop_id_texts())::text[]));
create policy "shop-logos: admins upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'shop-logos' and private.is_shop_admin_text((storage.foldername(name))[1]));
create policy "shop-logos: admins delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'shop-logos' and private.is_shop_admin_text((storage.foldername(name))[1]));

-- Sets (or clears, with null) the shop's logo. Returns the previous path so
-- the app can delete the old file.
create function public.set_shop_logo(p_shop_id uuid, p_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  if not private.has_role(p_shop_id, 'admin') then
    raise exception 'only the owner or an admin can change the logo' using errcode = '42501';
  end if;
  if p_path is not null then
    if p_path !~ ('^' || p_shop_id::text || '/[A-Za-z0-9_-]{1,64}\.(png|jpg)$') then
      raise exception 'invalid logo path' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'shop-logos' and o.name = p_path) then
      raise exception 'upload the logo first' using errcode = 'P0002';
    end if;
  end if;
  select logo_path into v_old from public.shops where id = p_shop_id for update;
  update public.shops set logo_path = p_path where id = p_shop_id;
  return v_old;
end;
$$;

revoke execute on function public.set_shop_logo(uuid, text) from public, anon, authenticated;
grant execute on function public.set_shop_logo(uuid, text) to authenticated;
