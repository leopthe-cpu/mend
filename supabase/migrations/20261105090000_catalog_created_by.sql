-- "Added by" on catalog items (19 Oct feedback, item 11; decision 106).
-- Filled from the signed-in person when an item is created, and never
-- changed afterwards, whatever the client sends: a trigger sets it, because
-- Admins may update catalog rows directly (RLS) and could otherwise rewrite
-- it. Items created before this, or by onboarding seeds without a person,
-- stay empty ("—").
alter table public.catalog_items
  add column created_by uuid references auth.users (id) on delete set null;
create index catalog_items_created_by_idx on public.catalog_items (created_by);

create function private.catalog_item_created_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;
revoke execute on function private.catalog_item_created_by() from public, anon, authenticated;

create trigger catalog_items_created_by before insert or update on public.catalog_items
  for each row execute function private.catalog_item_created_by();
