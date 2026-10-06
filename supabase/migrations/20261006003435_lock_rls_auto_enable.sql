-- Supabase created `public.rls_auto_enable()` (the event-trigger function behind
-- "Enable automatic RLS", ticked when the hosted project was created). It is
-- SECURITY DEFINER in the exposed `public` schema and was executable by anon
-- and authenticated, so the Security Advisor flagged it (lints 0028/0029).
-- Event triggers don't need callers to hold EXECUTE, so revoking it keeps the
-- auto-RLS behaviour and removes the API surface.
--
-- Conditional because the local/CI stack doesn't create this function.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
