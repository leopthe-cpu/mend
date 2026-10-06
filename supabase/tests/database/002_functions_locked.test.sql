-- Functions are executable by PUBLIC by default in Postgres. Nothing we write
-- may be callable by anon, and only allow-listed helpers by authenticated.
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

-- Our own functions only: skip anything owned by an extension.
create temporary view our_functions as
  select p.oid, n.nspname, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and not exists (select 1 from pg_depend d
                      where d.objid = p.oid and d.deptype = 'e');

-- anon: only the invite preview (the invite page before sign-in).
select is_empty(
  $$ select nspname || '.' || proname from our_functions
      where has_function_privilege('anon', oid, 'EXECUTE')
        and nspname || '.' || proname <> all (array['public.invite_preview']) $$,
  'anon can execute only allow-listed functions'
);

-- Extend this allow-list deliberately when a helper must be callable by users
-- (e.g. RLS helpers and RPCs in Phase 1B).
select is_empty(
  $$ select nspname || '.' || proname from our_functions
      where has_function_privilege('authenticated', oid, 'EXECUTE')
        and nspname || '.' || proname <> all (array[
          -- RLS helpers (policies run as the caller)
          'private.role_rank', 'private.my_shop_ids', 'private.my_role',
          'private.has_role', 'private.my_coworker_ids',
          'private.my_shop_id_texts', 'private.is_shop_admin_text',
          -- RPCs: each checks the caller's role itself
          'public.create_shop', 'public.create_invite', 'public.invite_preview',
          'public.accept_invite', 'public.revoke_invite', 'public.change_member_role',
          'public.remove_member', 'public.transfer_ownership',
          'public.save_customer', 'public.customer_contacts', 'public.search_shop',
          'public.create_ticket', 'public.set_ticket_status', 'public.set_ticket_passcode',
          'public.reveal_passcode', 'public.add_ticket_note', 'public.delete_ticket',
          'public.start_estimate', 'public.revise_estimate', 'public.add_estimate_line',
          'public.add_custom_line', 'public.update_estimate_line', 'public.set_line_discount',
          'public.remove_estimate_line', 'public.set_estimate_status', 'public.issue_invoice',
          'public.record_payment', 'public.update_payment', 'public.delete_payment',
          'public.save_catalog_item', 'public.finish_shop_setup', 'public.onboarding_state', 'public.export_shop', 'public.set_shop_logo',
          'public.queue_message', 'public.cancel_message', 'public.set_customer_opt_out'
        ]) $$,
  'authenticated can execute only allow-listed functions'
);

select * from finish();
rollback;
