-- Texts (decision 84).
--
-- 1. Monthly text limit per shop: 100 by default (was 500). Twilio bills per
--    message segment, so this caps a shop's text cost; higher pricing tiers can
--    raise sms_monthly_cap per shop later (it stays server-managed, not
--    client-writable). Shops still on the old default move to 100.
--
-- 2. Plain punctuation in texts. One character outside the GSM-7 alphabet
--    (an en dash in "9am–5pm", a curly apostrophe pasted from a phone) makes
--    the whole text UCS-2: 70 characters per segment instead of 160, so a
--    normal update costs two or three segments instead of one. Texts get
--    dashes, curly quotes, ellipses and special spaces swapped for their plain
--    versions before they are stored. Emails keep the original characters.
--    Letters with accents are left alone (most common ones, like é, are in GSM-7).

alter table public.shops alter column sms_monthly_cap set default 100;
update public.shops set sms_monthly_cap = 100 where sms_monthly_cap = 500;

create function private.sms_plain_text(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
           coalesce(p_text, ''),
           E'–', '-'), E'—', '-'), E'‒', '-'), E'−', '-'),
           E'‘', ''''), E'’', ''''), E'ʼ', ''''),
           E'“', '"'), E'”', '"'),
           E'…', '...'),
           E' ', ' '), E' ', ' ');
$$;

create function private.sms_plain_text_trigger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.channel = 'sms' then
    new.body := private.sms_plain_text(new.body);
  end if;
  return new;
end;
$$;

-- Runs before messages_sms_stop_notice (triggers fire in name order), so the
-- STOP notice's length check sees the final body.
create trigger messages_sms_plain_text
  before insert on public.messages
  for each row execute function private.sms_plain_text_trigger();

revoke execute on function
  private.sms_plain_text(text),
  private.sms_plain_text_trigger()
  from public, anon, authenticated;
