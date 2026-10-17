-- Decision 86: how long closed tickets are kept.
--
-- A ticket is "closed" when it reaches a final status (picked up) or is
-- deleted. Once the shop's retention period has passed since then (12 months
-- by default; higher pricing tiers can raise retention_months per shop,
-- server-managed like sms_monthly_cap):
--   - photos (files and rows), messages, timeline events, notes, descriptions
--     and custom fields of the ticket are deleted;
--   - a ticket with no invoice and no payment is deleted entirely;
--   - a ticket with an invoice or a payment keeps only what the invoice needs
--     (number, item name, dates, quote lines, invoice, payments), because the
--     CRA asks businesses to keep records for six years after the end of the
--     tax year they relate to. Those are deleted 7 years after the end of the
--     calendar year of the last invoice or payment, which covers any fiscal
--     year end;
--   - a customer whose tickets are all past the period loses phone, email and
--     notes (the name stays on kept invoices), or is deleted when no ticket
--     is left.
--
-- Shops see a banner 30 days ahead (public.retention_notice). Oz sees every
-- shop with deletions coming up in private.retention_upcoming (SQL editor)
-- and can pause a shop with shops.retention_hold, e.g. while it downloads its
-- data. Storage files can't be deleted with SQL, so the retention-photos Edge
-- Function deletes photo files first; tickets are only purged once no photo
-- rows are left.

alter table public.shops
  add column retention_months integer not null default 12 check (retention_months between 12 and 72),
  add column retention_hold boolean not null default false;
-- Not added to the column update grant: only the service role or the
-- dashboard changes them.

alter table public.tickets add column retention_purged_at timestamptz;
grant select (retention_purged_at) on public.tickets to authenticated;
alter table public.customers add column retention_purged_at timestamptz;
grant select (retention_purged_at) on public.customers to authenticated;

-- The ticket triggers skip the retention clearing.
create or replace function private.validate_ticket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
  v jsonb;
  k text;
  v_full boolean := tg_op = 'INSERT';
begin
  -- Clearing a ticket for retention (decision 86) is neither an edit nor a
  -- change to validate; only retention_run can set retention_purged_at.
  if tg_op = 'UPDATE' and old.retention_purged_at is null and new.retention_purged_at is not null then
    return new;
  end if;
  if new.assigned_to is not null
     and (v_full or new.assigned_to is distinct from old.assigned_to)
     and not exists (
       select 1 from public.memberships m where m.shop_id = new.shop_id and m.user_id = new.assigned_to
     ) then
    raise exception 'assignee must be a member of the shop' using errcode = '22023';
  end if;

  if not v_full and new.custom_fields is not distinct from old.custom_fields then
    return new;
  end if;

  -- Keys that are new or changed must be known fields. Values left untouched
  -- (e.g. for a field an admin has since deleted) are kept as they are.
  for k in select jsonb_object_keys(new.custom_fields) loop
    if (v_full or (new.custom_fields -> k) is distinct from (old.custom_fields -> k))
       and not exists (
         select 1 from public.custom_field_definitions c where c.shop_id = new.shop_id and c.id::text = k
       ) then
      raise exception 'unknown custom field' using errcode = '22023';
    end if;
  end loop;

  for d in select * from public.custom_field_definitions c where c.shop_id = new.shop_id loop
    v := new.custom_fields -> d.id::text;
    if not v_full and v is not distinct from (old.custom_fields -> d.id::text) then
      continue;
    end if;
    if v is null or v = 'null'::jsonb or v = '""'::jsonb then
      if d.required then
        raise exception '% is required', d.label using errcode = '22023';
      end if;
      continue;
    end if;
    if d.field_type = 'number' and jsonb_typeof(v) <> 'number' then
      raise exception '% must be a number', d.label using errcode = '22023';
    elsif d.field_type = 'date' and (jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$') then
      raise exception '% must be a date', d.label using errcode = '22023';
    elsif d.field_type = 'select' and not (d.options ? (v #>> '{}')) then
      raise exception '% must be one of the listed options', d.label using errcode = '22023';
    elsif d.field_type = 'text' and (jsonb_typeof(v) <> 'string' or length(v #>> '{}') > 500) then
      raise exception '% must be text (up to 500 characters)', d.label using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$$;

create or replace function private.ticket_edit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text[] := array[]::text[];
begin
  -- Clearing a ticket for retention (decision 86) is neither an edit nor a
  -- change to validate; only retention_run can set retention_purged_at.
  if tg_op = 'UPDATE' and old.retention_purged_at is null and new.retention_purged_at is not null then
    return new;
  end if;
  if new.item_name is distinct from old.item_name then v_changed := array_append(v_changed, 'item'); end if;
  if new.item_description is distinct from old.item_description then v_changed := array_append(v_changed, 'item description'); end if;
  if new.issue_description is distinct from old.issue_description then v_changed := array_append(v_changed, 'issue'); end if;
  if new.promised_date is distinct from old.promised_date then v_changed := array_append(v_changed, 'promised date'); end if;
  if new.custom_fields is distinct from old.custom_fields then v_changed := array_append(v_changed, 'details'); end if;
  if new.internal_notes is distinct from old.internal_notes then v_changed := array_append(v_changed, 'internal notes'); end if;
  if new.customer_notes is distinct from old.customer_notes then v_changed := array_append(v_changed, 'customer notes'); end if;
  if array_length(v_changed, 1) > 0 then
    perform private.ticket_event(new.shop_id, new.id, 'edit', jsonb_build_object('fields', v_changed));
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    perform private.ticket_event(new.shop_id, new.id, 'assigned', jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to));
  end if;
  return new;
end;
$$;

-- When each still-unpurged closed ticket is due. Holds are left out.
create function private.retention_due(p_within interval default '0 seconds')
returns table (shop_id uuid, ticket_id uuid, due_at timestamptz, has_money boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select x.shop_id, x.id, x.due_at,
         exists (select 1 from public.invoices i where i.ticket_id = x.id)
           or exists (select 1 from public.payments p where p.ticket_id = x.id)
    from (
      select t.shop_id, t.id,
             coalesce(t.deleted_at, t.picked_up_at, t.status_changed_at)
               + make_interval(months => s.retention_months) as due_at
        from public.tickets t
        join public.shops s on s.id = t.shop_id
        join public.statuses st on st.id = t.status_id
       where t.retention_purged_at is null
         and not s.retention_hold
         and (t.deleted_at is not null or st.is_final)
    ) x
   where x.due_at <= now() + p_within;
$$;

-- Service role (retention-photos): photo files of due tickets, oldest first.
create function public.retention_claim_photos(p_limit integer default 200)
returns table (photo_id uuid, storage_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select ph.id, ph.storage_path
    from public.ticket_photos ph
    join private.retention_due() d on d.ticket_id = ph.ticket_id
   order by d.due_at
   limit least(greatest(p_limit, 1), 1000);
$$;

-- Service role: drop the rows of photos whose files were deleted.
create function public.retention_photos_removed(p_photo_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.ticket_photos ph
   using private.retention_due() d
   where d.ticket_id = ph.ticket_id and ph.id = any (p_photo_ids);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Purge every due ticket that has no photos left, then old money records and
-- customers. Run daily by pg_cron and by retention-photos after it deletes
-- files. Writes one audit row per shop and run.
create function public.retention_run()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer := 0;
  v_stripped integer := 0;
  v_expired integer := 0;
  v_cust_deleted integer := 0;
  v_cust_stripped integer := 0;
  r record;
begin
  create temp table if not exists pg_temp.retention_work (shop_id uuid, ticket_id uuid, has_money boolean) on commit drop;
  truncate pg_temp.retention_work;
  insert into pg_temp.retention_work
    select d.shop_id, d.ticket_id, d.has_money from private.retention_due() d
     where not exists (select 1 from public.ticket_photos ph where ph.ticket_id = d.ticket_id);

  delete from public.messages m using pg_temp.retention_work w where m.ticket_id = w.ticket_id;
  delete from public.ticket_events e using pg_temp.retention_work w where e.ticket_id = w.ticket_id;

  delete from public.tickets t using pg_temp.retention_work w where t.id = w.ticket_id and not w.has_money;
  get diagnostics v_deleted = row_count;

  update public.tickets t
     set item_description = null, issue_description = null, internal_notes = null,
         customer_notes = null, custom_fields = '{}'::jsonb, passcode_encrypted = null,
         retention_purged_at = now()
    from pg_temp.retention_work w
   where t.id = w.ticket_id and w.has_money;
  get diagnostics v_stripped = row_count;

  -- Money records past the tax-record period.
  with old as (
    select t.id
      from public.tickets t
      join public.shops s on s.id = t.shop_id
     where t.retention_purged_at is not null and not s.retention_hold
       and date_trunc('year', greatest(
             t.retention_purged_at,
             coalesce((select max(i.issued_at) from public.invoices i where i.ticket_id = t.id), '-infinity'),
             coalesce((select max(p.paid_on)::timestamptz from public.payments p where p.ticket_id = t.id), '-infinity')
           )) + interval '8 years' <= now()
  )
  delete from public.tickets t using old where t.id = old.id;
  get diagnostics v_expired = row_count;

  -- Customers: deleted once no ticket is left, else reduced to the name
  -- (kept invoices show it) once every ticket is past the period.
  delete from public.customers cu using public.shops s
   where s.id = cu.shop_id and not s.retention_hold
     and cu.created_at + make_interval(months => s.retention_months) <= now()
     and not exists (select 1 from public.tickets t where t.customer_id = cu.id);
  get diagnostics v_cust_deleted = row_count;

  update public.customers cu
     set phone_encrypted = null, phone_hash = null, email_encrypted = null, email_hash = null,
         notes = null, retention_purged_at = now()
    from public.shops s
   where s.id = cu.shop_id and not s.retention_hold
     and cu.retention_purged_at is null
     and cu.created_at + make_interval(months => s.retention_months) <= now()
     and exists (select 1 from public.tickets t where t.customer_id = cu.id)
     and not exists (select 1 from public.tickets t where t.customer_id = cu.id and t.retention_purged_at is null);
  get diagnostics v_cust_stripped = row_count;

  for r in select w.shop_id, count(*) filter (where not w.has_money) as deleted,
                  count(*) filter (where w.has_money) as stripped
             from pg_temp.retention_work w group by w.shop_id
  loop
    perform private.audit(r.shop_id, 'retention.purged', 'shops', r.shop_id, null,
      jsonb_build_object('tickets_deleted', r.deleted, 'tickets_cleared', r.stripped));
  end loop;

  return jsonb_build_object('tickets_deleted', v_deleted, 'tickets_cleared', v_stripped,
    'money_records_expired', v_expired, 'customers_deleted', v_cust_deleted,
    'customers_cleared', v_cust_stripped);
end;
$$;

-- Owner/Admin: what will be deleted in the next 30 days (the in-app banner).
create function public.retention_notice(p_shop_id uuid)
returns table (tickets_due integer, first_due date, retention_months integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_shop_id, 'admin') then
    raise exception 'only the owner or an admin can see this' using errcode = '42501';
  end if;
  return query
    select count(*)::integer,
           (min(d.due_at) at time zone (select s.time_zone from public.shops s where s.id = p_shop_id))::date,
           (select s.retention_months from public.shops s where s.id = p_shop_id)
      from private.retention_due(interval '30 days') d
     where d.shop_id = p_shop_id;
end;
$$;

-- For Oz in the SQL editor: every shop with deletions in the next 30 days,
-- including held ones. `select * from private.retention_upcoming;`
create view private.retention_upcoming as
  select s.id as shop_id, s.name as shop_name, u.email as owner_email,
         s.retention_months, s.retention_hold,
         count(t.id) as tickets_due_30_days,
         min(coalesce(t.deleted_at, t.picked_up_at, t.status_changed_at)
               + make_interval(months => s.retention_months)) as first_due
    from public.shops s
    join public.tickets t on t.shop_id = s.id and t.retention_purged_at is null
    join public.statuses st on st.id = t.status_id
    left join public.memberships m on m.shop_id = s.id and m.role = 'owner'
    left join auth.users u on u.id = m.user_id
   where (t.deleted_at is not null or st.is_final)
     and coalesce(t.deleted_at, t.picked_up_at, t.status_changed_at)
           + make_interval(months => s.retention_months) <= now() + interval '30 days'
   group by s.id, s.name, u.email, s.retention_months, s.retention_hold;
revoke all on private.retention_upcoming from public, anon, authenticated;

-- Daily job: purge what has no photos, then ask the Edge Function to delete
-- due photo files (same Vault entries as the message dispatcher; without
-- them, e.g. locally and in CI, photos simply wait).
create function private.retention_daily()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := private.secret('mend_project_url');
  v_key text := private.secret('mend_publishable_key');
begin
  perform public.retention_run();
  if v_url is null or v_key is null then
    return;
  end if;
  if not exists (select 1 from public.retention_claim_photos(1)) then
    return;
  end if;
  perform net.http_post(
    url := v_url || '/functions/v1/retention-photos',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_key, 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb
  );
end;
$$;

revoke execute on function
  private.retention_due(interval),
  public.retention_claim_photos(integer),
  public.retention_photos_removed(uuid[]),
  public.retention_run(),
  public.retention_notice(uuid),
  private.retention_daily()
from public, anon, authenticated;
grant execute on function
  public.retention_claim_photos(integer),
  public.retention_photos_removed(uuid[]),
  public.retention_run()
to service_role;
grant execute on function public.retention_notice(uuid) to authenticated;

-- 07:17 UTC daily: night in Canada, off the top of the hour.
select cron.schedule('mend-retention-daily', '17 7 * * *', 'select private.retention_daily()');
