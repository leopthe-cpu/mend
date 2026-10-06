-- Phase 5: per-shop data export, Owner only (spec §4 "Other defaults", §9
-- Phase 5; decision 56). Everything the shop owns, in one JSON document:
-- customers with their phone and email decrypted (the Owner can already see
-- them in the app), tickets, estimates, invoices, payments, messages, catalog,
-- settings, team and the audit log.
--
-- Left out on purpose:
-- - device passcodes (tickets.passcode_encrypted): the spec treats them as
--   the most sensitive field; the export says which tickets have one;
-- - blind-index hashes and invite token hashes (useless outside Mend, and the
--   hashes would help guess phone numbers);
-- - photo files themselves (only their paths): files are downloaded through
--   Storage, not through the database.
--
-- Needs a fresh password (and the MFA code if enrolled), like ownership
-- transfer, because it hands over every customer's contact details at once.
-- Every export is written to the audit log.

create function public.export_shop(p_shop_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if private.my_role(p_shop_id) is distinct from 'owner' then
    raise exception 'only the owner can export the shop''s data' using errcode = '42501';
  end if;
  if not private.recently_reauthenticated() then
    raise exception 'please confirm your password again' using errcode = '42501', hint = 'reauthentication_needed';
  end if;

  select jsonb_build_object(
    'format', 'mend-export',
    'version', 1,
    'exported_at', now(),
    'shop', (select to_jsonb(s) from public.shops s where s.id = p_shop_id),
    'team', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'user_id', m.user_id, 'role', m.role, 'name', p.full_name, 'email', p.email,
               'joined_at', m.created_at) order by m.created_at), '[]'::jsonb)
        from public.memberships m left join public.profiles p on p.user_id = m.user_id
       where m.shop_id = p_shop_id),
    'invites', (
      select coalesce(jsonb_agg(to_jsonb(i) - 'token_hash' order by i.created_at), '[]'::jsonb)
        from public.invites i where i.shop_id = p_shop_id),
    'customers', (
      select coalesce(jsonb_agg(
               (to_jsonb(c) - array['phone_encrypted', 'phone_hash', 'email_encrypted', 'email_hash'])
               || jsonb_build_object('phone', private.pii_decrypt(c.phone_encrypted),
                                     'email', private.pii_decrypt(c.email_encrypted))
               order by c.created_at), '[]'::jsonb)
        from public.customers c where c.shop_id = p_shop_id),
    'tickets', (
      select coalesce(jsonb_agg(to_jsonb(t) - 'passcode_encrypted' order by t.ticket_number), '[]'::jsonb)
        from public.tickets t where t.shop_id = p_shop_id),
    'ticket_events', (
      select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at), '[]'::jsonb)
        from public.ticket_events e where e.shop_id = p_shop_id),
    'ticket_photos', (
      select coalesce(jsonb_agg(to_jsonb(ph) order by ph.created_at), '[]'::jsonb)
        from public.ticket_photos ph where ph.shop_id = p_shop_id),
    'statuses', (
      select coalesce(jsonb_agg(to_jsonb(st) order by st.position), '[]'::jsonb)
        from public.statuses st where st.shop_id = p_shop_id),
    'custom_fields', (
      select coalesce(jsonb_agg(to_jsonb(f) order by f.position), '[]'::jsonb)
        from public.custom_field_definitions f where f.shop_id = p_shop_id),
    'message_templates', (
      select coalesce(jsonb_agg(to_jsonb(mt) order by mt.created_at), '[]'::jsonb)
        from public.message_templates mt where mt.shop_id = p_shop_id),
    'tax_rates', (
      select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at), '[]'::jsonb)
        from public.tax_rates r where r.shop_id = p_shop_id),
    'catalog_items', (
      select coalesce(jsonb_agg(to_jsonb(ci) order by ci.name), '[]'::jsonb)
        from public.catalog_items ci where ci.shop_id = p_shop_id),
    'catalog_item_tax_rates', (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
        from public.catalog_item_tax_rates x where x.shop_id = p_shop_id),
    'catalog_item_costs', (
      select coalesce(jsonb_agg(to_jsonb(cc)), '[]'::jsonb)
        from public.catalog_item_costs cc where cc.shop_id = p_shop_id),
    'estimates', (
      select coalesce(jsonb_agg(to_jsonb(es) order by es.created_at), '[]'::jsonb)
        from public.estimates es where es.shop_id = p_shop_id),
    'estimate_line_items', (
      select coalesce(jsonb_agg(to_jsonb(l) order by l.position), '[]'::jsonb)
        from public.estimate_line_items l where l.shop_id = p_shop_id),
    'invoices', (
      select coalesce(jsonb_agg(to_jsonb(inv) order by inv.issued_at), '[]'::jsonb)
        from public.invoices inv where inv.shop_id = p_shop_id),
    'payments', (
      select coalesce(jsonb_agg(to_jsonb(pa) order by pa.paid_on), '[]'::jsonb)
        from public.payments pa where pa.shop_id = p_shop_id),
    'messages', (
      select coalesce(jsonb_agg(to_jsonb(ms) order by ms.created_at), '[]'::jsonb)
        from public.messages ms where ms.shop_id = p_shop_id),
    'audit_log', (
      select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at), '[]'::jsonb)
        from public.audit_log a where a.shop_id = p_shop_id)
  ) into v_out;

  perform private.audit(p_shop_id, 'shop.exported', 'shops', p_shop_id, null,
    jsonb_build_object('customers', jsonb_array_length(v_out -> 'customers'),
                       'tickets', jsonb_array_length(v_out -> 'tickets')));
  return v_out;
end;
$$;

revoke execute on function public.export_shop(uuid) from public, anon, authenticated;
grant execute on function public.export_shop(uuid) to authenticated;
