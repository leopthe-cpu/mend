-- Security Advisor (lint 0014 extension_in_public): `create extension pg_net`
-- in 20261006060100 registered the extension in the public schema. Re-create
-- it in the `extensions` schema. Its functions live in the `net` schema either
-- way, so private.dispatch_due_messages() (net.http_post) is unaffected;
-- only pending HTTP requests and the 6-hour response log are reset.
do $$
begin
  if exists (
    select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
     where e.extname = 'pg_net' and n.nspname = 'public'
  ) then
    drop extension pg_net;
    create extension pg_net with schema extensions;
  end if;
end;
$$;
