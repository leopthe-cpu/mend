-- Decision 88: every email Mend sends carries an unsubscribe link and the
-- shop's name and address (CASL: identification and an unsubscribe
-- mechanism, docs/legal-compliance.md §3.3), plus List-Unsubscribe headers so
-- mail apps can show their own "Unsubscribe" button (one-click POST).
--
-- Each customer gets a random token. The link opens /unsubscribe?t=<token>
-- in the web app, which asks before stopping anything (link scanners open
-- links); mail apps' one-click POST goes to the email-unsubscribe Edge
-- Function. Both end in public.email_unsubscribe.

alter table public.customers
  add column unsubscribe_token uuid not null default gen_random_uuid() unique;
-- Not in the customers column select grant: only the server sees tokens.

-- Service role (send-messages): what to put in an email's footer and headers.
create function public.email_footer_for(p_message_id uuid)
returns table (token uuid, page_url text, shop_name text, shop_address text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.unsubscribe_token,
         (select value from private.app_settings where key = 'public_base_url')
           || '/unsubscribe?t=' || c.unsubscribe_token::text,
         s.name, s.address
    from public.messages m
    join public.customers c on c.id = m.customer_id
    join public.shops s on s.id = m.shop_id
   where m.id = p_message_id;
$$;

-- Anyone with the link: which shop, and whether emails already stopped.
create function public.unsubscribe_preview(p_token uuid)
returns table (shop_name text, already_stopped boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.name, c.email_opted_out
    from public.customers c join public.shops s on s.id = c.shop_id
   where c.unsubscribe_token = p_token;
$$;

-- Anyone with the link: stop emails for this customer at this shop, cancel
-- queued ones, audit it. Returns false when the token is unknown.
create function public.email_unsubscribe(p_token uuid, p_source text default 'link')
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.customers;
begin
  select * into c from public.customers where unsubscribe_token = p_token;
  if not found then
    return false;
  end if;
  if not c.email_opted_out then
    update public.customers set email_opted_out = true where id = c.id;
    update public.messages set status = 'canceled', error = 'customer unsubscribed'
     where customer_id = c.id and channel = 'email' and status = 'queued';
    perform private.audit(c.shop_id, 'customer.email_unsubscribed', 'customers', c.id, null,
      jsonb_build_object('source', case when p_source = 'one-click' then 'one-click' else 'link' end));
  end if;
  return true;
end;
$$;

revoke execute on function
  public.email_footer_for(uuid),
  public.unsubscribe_preview(uuid),
  public.email_unsubscribe(uuid, text)
from public, anon, authenticated;
grant execute on function public.email_footer_for(uuid) to service_role;
grant execute on function public.unsubscribe_preview(uuid), public.email_unsubscribe(uuid, text) to anon, authenticated, service_role;
