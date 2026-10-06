-- Performance Advisor (lint 0001): cover every foreign key with an index so
-- deletes/cascades and joins don't scan whole tables.
create index audit_log_actor_id_idx on public.audit_log (actor_id);
create index catalog_item_tax_rates_shop_item_idx on public.catalog_item_tax_rates (shop_id, catalog_item_id);
create index catalog_item_tax_rates_shop_rate_idx on public.catalog_item_tax_rates (shop_id, tax_rate_id);
create index invites_invited_by_idx on public.invites (invited_by);
create index invites_used_by_idx on public.invites (used_by);
create index message_templates_shop_status_idx on public.message_templates (shop_id, status_id);
create index shops_created_by_idx on public.shops (created_by);
