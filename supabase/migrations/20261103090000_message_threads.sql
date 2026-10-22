-- Messages as conversations (19 Oct feedback, item 10; decision 104): one row
-- per customer the shop has messaged, with the latest message for the
-- preview. security_invoker, so the messages and customers RLS of the person
-- asking applies (001_rls_everywhere checks this); no new function.
create view public.message_threads with (security_invoker = true) as
  select distinct on (m.shop_id, m.customer_id)
         m.shop_id,
         m.customer_id,
         c.name as customer_name,
         m.id as last_message_id,
         m.channel as last_channel,
         m.subject as last_subject,
         m.body as last_body,
         m.status as last_status,
         m.created_at as last_at
    from public.messages m
    join public.customers c on c.shop_id = m.shop_id and c.id = m.customer_id
   order by m.shop_id, m.customer_id, m.created_at desc;

revoke all on public.message_threads from public, anon;
grant select on public.message_threads to authenticated;
