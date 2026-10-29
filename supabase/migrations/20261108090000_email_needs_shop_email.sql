-- Emails need the shop's email address (Oz, 28 Oct; decision 143), the same
-- way texts need the address and phone (decision 131). Customers reply to it,
-- and the message window can no longer offer an email nobody can answer.
-- Refused on insert, so every path is covered: the message window, reminders,
-- and the automatic "ticket created" email, which is skipped and audited
-- (message.created_skipped) like the text.

create function private.email_needs_shop_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.channel = 'email' and not exists (
    select 1 from public.shops s
     where s.id = new.shop_id and nullif(btrim(coalesce(s.email, '')), '') is not null
  ) then
    raise exception 'add your shop''s email in Settings → Shop before emailing customers'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function private.email_needs_shop_email() from public, anon, authenticated;

create trigger messages_email_needs_shop_email
  before insert on public.messages
  for each row execute function private.email_needs_shop_email();
