-- Performance Advisor (lint 0001) after Phase 3: cover the two composite
-- foreign keys that had no matching index.
create index catalog_item_costs_shop_item_idx on public.catalog_item_costs (shop_id, catalog_item_id);
create index invoices_shop_estimate_idx on public.invoices (shop_id, estimate_id);
