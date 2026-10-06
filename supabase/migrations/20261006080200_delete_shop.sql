-- Phase 5: delete a shop and all its data (spec §4 "a documented way to
-- delete a shop's data"; decision 58). Owner only, fresh password, and the
-- shop's name typed to confirm.
--
-- Files first: the app deletes the shop's photos and logo through the Storage
-- API (deleting storage rows in SQL would leave the files themselves behind),
-- and this function refuses while any file is left, so nothing is orphaned.
-- Then one DELETE on shops cascades to every table. The delete guards
-- (statuses, catalog items, memberships, audit log) all allow rows to go when
-- their shop is gone. Team members keep their Mend accounts; they just no
-- longer belong to the shop. The audit log goes with the shop, so the deletion
-- itself is written to the database log (RAISE LOG) instead.

create function public.delete_shop(p_shop_id uuid, p_confirm_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_files integer;
begin
  if private.my_role(p_shop_id) is distinct from 'owner' then
    raise exception 'only the owner can delete the shop' using errcode = '42501';
  end if;
  if not private.recently_reauthenticated() then
    raise exception 'please confirm your password again' using errcode = '42501', hint = 'reauthentication_needed';
  end if;
  select name into v_name from public.shops where id = p_shop_id for update;
  if lower(btrim(coalesce(p_confirm_name, ''))) <> lower(v_name) then
    raise exception 'type the shop''s name exactly to confirm' using errcode = '22023';
  end if;
  select count(*) into v_files
    from storage.objects o
   where o.bucket_id in ('ticket-photos', 'shop-logos')
     and (storage.foldername(o.name))[1] = p_shop_id::text;
  if v_files > 0 then
    raise exception 'the shop''s photos must be removed first' using errcode = '22023', hint = 'files_remaining';
  end if;

  delete from public.shops where id = p_shop_id;
  raise log 'mend: shop % (%) deleted by user %', p_shop_id, v_name, (select auth.uid());
end;
$$;

revoke execute on function public.delete_shop(uuid, text) from public, anon, authenticated;
grant execute on function public.delete_shop(uuid, text) to authenticated;
