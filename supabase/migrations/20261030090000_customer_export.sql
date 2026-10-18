-- Decision 87: export one customer's data, for a privacy access request
-- (PIPEDA lets a person ask a business for the personal information it holds
-- about them). Owner or Admin; written to the audit log.
--
-- Same rules as export_shop: no device passcodes, no blind-index hashes, and
-- photo paths only (files are downloaded through Storage). Unlike the shop
-- export, no fresh password is asked for: it covers one person the Owner or
-- Admin can already see in full in the app.

create function public.export_customer(p_customer_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c public.customers;
  v_out jsonb;
begin
  select * into c from public.customers where id = p_customer_id;
  if not found or not private.has_role(c.shop_id, 'staff') then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  if not private.has_role(c.shop_id, 'admin') then
    raise exception 'only the owner or an admin can export a customer''s data' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'format', 'mend-customer-export',
    'version', 1,
    'exported_at', now(),
    'shop', (select jsonb_build_object('name', s.name, 'address', s.address, 'phone', s.phone, 'email', s.email)
               from public.shops s where s.id = c.shop_id),
    'customer', (to_jsonb(c) - array['phone_encrypted', 'phone_hash', 'email_encrypted', 'email_hash'])
                || jsonb_build_object('phone', private.pii_decrypt(c.phone_encrypted),
                                      'email', private.pii_decrypt(c.email_encrypted)),
    'tickets', (
      select coalesce(jsonb_agg(to_jsonb(t) - 'passcode_encrypted' order by t.ticket_number), '[]'::jsonb)
        from public.tickets t where t.customer_id = c.id),
    'ticket_events', (
      select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at), '[]'::jsonb)
        from public.ticket_events e join public.tickets t on t.id = e.ticket_id where t.customer_id = c.id),
    'ticket_photos', (
      select coalesce(jsonb_agg(to_jsonb(ph) order by ph.created_at), '[]'::jsonb)
        from public.ticket_photos ph join public.tickets t on t.id = ph.ticket_id where t.customer_id = c.id),
    'estimates', (
      select coalesce(jsonb_agg(to_jsonb(es) order by es.created_at), '[]'::jsonb)
        from public.estimates es join public.tickets t on t.id = es.ticket_id where t.customer_id = c.id),
    'estimate_line_items', (
      select coalesce(jsonb_agg(to_jsonb(l) order by l.estimate_id, l.position), '[]'::jsonb)
        from public.estimate_line_items l
        join public.estimates es on es.id = l.estimate_id
        join public.tickets t on t.id = es.ticket_id
       where t.customer_id = c.id),
    'invoices', (
      select coalesce(jsonb_agg(to_jsonb(inv) order by inv.issued_at), '[]'::jsonb)
        from public.invoices inv join public.tickets t on t.id = inv.ticket_id where t.customer_id = c.id),
    'payments', (
      select coalesce(jsonb_agg(to_jsonb(pa) order by pa.paid_on), '[]'::jsonb)
        from public.payments pa join public.tickets t on t.id = pa.ticket_id where t.customer_id = c.id),
    'messages', (
      select coalesce(jsonb_agg(to_jsonb(ms) order by ms.created_at), '[]'::jsonb)
        from public.messages ms where ms.customer_id = c.id)
  ) into v_out;

  perform private.audit(c.shop_id, 'customer.exported', 'customers', c.id, null,
    jsonb_build_object('tickets', jsonb_array_length(v_out -> 'tickets')));
  return v_out;
end;
$$;

revoke execute on function public.export_customer(uuid) from public, anon, authenticated;
grant execute on function public.export_customer(uuid) to authenticated;
