-- Phase 4: webhook helpers and the per-minute dispatcher.
--
-- The scheduler calls the send-messages Edge Function every minute, but only
-- when something is due, using the pattern from Supabase's "Scheduling Edge
-- Functions" guide (pg_cron + pg_net, URL and key read from Vault). The two
-- Vault entries are per environment, so they are not created here: until they
-- exist (e.g. locally and in CI), the job does nothing. Production values:
-- docs/supabase-setup.md (decision 48).

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
create extension if not exists pg_net;

-- A provider's message id identifies exactly one of our messages; webhooks
-- look messages up by it.
drop index public.messages_provider_idx;
create unique index messages_provider_id_key on public.messages (provider, provider_message_id)
  where provider_message_id is not null;

-- Service role: the SID we stored when sending (status callbacks carry our id).
create function public.provider_message_id_for(p_message_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select provider_message_id from public.messages where id = p_message_id;
$$;

-- Service role: a spam complaint on an email opts that customer out of email.
create function public.record_email_complaint(p_provider_message_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages;
begin
  select * into m from public.messages where provider = 'resend' and provider_message_id = p_provider_message_id;
  if not found then
    return;
  end if;
  update public.customers set email_opted_out = true where id = m.customer_id and not email_opted_out;
  if found then
    update public.messages set status = 'canceled', error = 'customer opted out'
     where customer_id = m.customer_id and channel = 'email' and status = 'queued';
    perform private.audit(m.shop_id, 'customer.email_complaint', 'customers', m.customer_id, null,
      jsonb_build_object('source', 'spam complaint'));
  end if;
end;
$$;

create function private.dispatch_due_messages()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := private.secret('mend_project_url');
  v_key text := private.secret('mend_publishable_key');
begin
  if v_url is null or v_key is null then
    return;
  end if;
  if not exists (select 1 from public.messages where status = 'queued' and scheduled_for <= now() and attempts < 3) then
    return;
  end if;
  perform net.http_post(
    url := v_url || '/functions/v1/send-messages',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_key, 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb
  );
end;
$$;

revoke execute on function
  public.provider_message_id_for(uuid),
  public.record_email_complaint(text),
  private.dispatch_due_messages()
from public, anon, authenticated;
grant execute on function
  public.provider_message_id_for(uuid),
  public.record_email_complaint(text)
to service_role;

select cron.schedule('mend-send-due-messages', '* * * * *', 'select private.dispatch_due_messages()');
