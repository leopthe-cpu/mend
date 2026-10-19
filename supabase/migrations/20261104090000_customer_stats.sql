-- Numbers for the customer list (19 Oct feedback, item 9; decision 105):
-- per customer, repairs picked up (final status), tickets still open, and the
-- last drop-off. Deleted tickets don't count. security_invoker, so the
-- tickets and statuses RLS of the person asking applies.
create view public.customer_stats with (security_invoker = true) as
  select t.shop_id,
         t.customer_id,
         count(*) filter (where s.is_final) as repairs_done,
         count(*) filter (where not s.is_final) as open_tickets,
         max(t.created_at) as last_ticket_at
    from public.tickets t
    join public.statuses s on s.shop_id = t.shop_id and s.id = t.status_id
   where t.deleted_at is null
   group by t.shop_id, t.customer_id;

revoke all on public.customer_stats from public, anon;
grant select on public.customer_stats to authenticated;
