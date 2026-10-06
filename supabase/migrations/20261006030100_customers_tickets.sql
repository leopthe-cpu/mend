-- Phase 2: customers, tickets, timeline, passcodes (docs/spec.md §6, §7.2-7.5).
-- Contact data and passcodes are stored only encrypted; clients can't select
-- those columns at all and go through the functions below, which check
-- membership and decrypt server-side.

create type public.preferred_channel as enum ('sms', 'email');
create type public.ticket_event_type as enum (
  'created', 'status_change', 'note', 'photo', 'edit', 'assigned',
  'passcode_set', 'passcode_revealed', 'passcode_purged', 'message', 'payment', 'estimate', 'deleted'
);

---------------------------------------------------------------------------
-- Customers
---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  phone_encrypted bytea,
  phone_hash text,
  email_encrypted bytea,
  email_hash text,
  preferred_channel public.preferred_channel not null default 'sms',
  sms_opted_out boolean not null default false,
  email_opted_out boolean not null default false,
  notes text check (char_length(notes) <= 2000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, id)
);
create index customers_shop_name_idx on public.customers (shop_id, lower(name));
create index customers_shop_phone_hash_idx on public.customers (shop_id, phone_hash);
create index customers_shop_email_hash_idx on public.customers (shop_id, email_hash);
create trigger customers_set_updated_at before update on public.customers
  for each row execute function private.set_updated_at();

alter table public.customers enable row level security;
-- Never the ciphertext or hashes: only these columns are selectable.
grant select (id, shop_id, name, preferred_channel, sms_opted_out, email_opted_out, notes, archived_at, created_at, updated_at)
  on public.customers to authenticated;
create policy customers_select_members on public.customers
  for select to authenticated
  using (shop_id = any ((select private.my_shop_ids())::uuid[]));

---------------------------------------------------------------------------
-- Tickets
---------------------------------------------------------------------------
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  ticket_number integer not null,
  customer_id uuid not null,
  item_name text not null check (char_length(btrim(item_name)) between 1 and 120),
  item_description text check (char_length(item_description) <= 2000),
  issue_description text check (char_length(issue_description) <= 4000),
  status_id uuid not null,
  status_changed_at timestamptz not null default now(),
  assigned_to uuid references auth.users (id) on delete set null,
  promised_date date,
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  passcode_encrypted bytea,
  has_passcode boolean generated always as (passcode_encrypted is not null) stored,
  internal_notes text check (char_length(internal_notes) <= 4000),
  customer_notes text check (char_length(customer_notes) <= 4000),
  terms_accepted_at timestamptz,
  picked_up_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, ticket_number),
  unique (shop_id, id),
  foreign key (shop_id, customer_id) references public.customers (shop_id, id),
  foreign key (shop_id, status_id) references public.statuses (shop_id, id)
);
create index tickets_shop_status_idx on public.tickets (shop_id, status_id) where deleted_at is null;
create index tickets_shop_customer_idx on public.tickets (shop_id, customer_id);
create index tickets_assigned_to_idx on public.tickets (assigned_to);
create index tickets_created_by_idx on public.tickets (created_by);
create trigger tickets_set_updated_at before update on public.tickets
  for each row execute function private.set_updated_at();

alter table public.tickets enable row level security;
grant select (
  id, shop_id, ticket_number, customer_id, item_name, item_description, issue_description,
  status_id, status_changed_at, assigned_to, promised_date, custom_fields, has_passcode,
  internal_notes, customer_notes, terms_accepted_at, picked_up_at, created_by, deleted_at,
  created_at, updated_at
) on public.tickets to authenticated;
-- Everyday edits by any member (spec matrix: "create and edit tickets").
-- Status, number, customer, passcode and deletion go through functions.
grant update (item_name, item_description, issue_description, assigned_to, promised_date, custom_fields, internal_notes, customer_notes)
  on public.tickets to authenticated;

create policy tickets_select_members on public.tickets
  for select to authenticated
  using (shop_id = any ((select private.my_shop_ids())::uuid[]) and deleted_at is null);
create policy tickets_update_members on public.tickets
  for update to authenticated
  using (shop_id = any ((select private.my_shop_ids())::uuid[]) and deleted_at is null)
  with check (shop_id = any ((select private.my_shop_ids())::uuid[]));

-- Validate custom fields against the shop's definitions and that the
-- assignee is a member of the shop.
create function private.validate_ticket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
  v jsonb;
begin
  if new.assigned_to is not null and not exists (
    select 1 from public.memberships m where m.shop_id = new.shop_id and m.user_id = new.assigned_to
  ) then
    raise exception 'assignee must be a member of the shop' using errcode = '22023';
  end if;
  -- Only known fields.
  if exists (
    select 1 from jsonb_object_keys(new.custom_fields) k
     where not exists (select 1 from public.custom_field_definitions c where c.shop_id = new.shop_id and c.id::text = k)
  ) then
    raise exception 'unknown custom field' using errcode = '22023';
  end if;
  for d in select * from public.custom_field_definitions c where c.shop_id = new.shop_id loop
    v := new.custom_fields -> d.id::text;
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
create trigger tickets_validate before insert or update on public.tickets
  for each row execute function private.validate_ticket();

---------------------------------------------------------------------------
-- Timeline
---------------------------------------------------------------------------
create table public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  ticket_id uuid not null,
  type public.ticket_event_type not null,
  actor_id uuid references auth.users (id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (shop_id, ticket_id) references public.tickets (shop_id, id) on delete cascade
);
create index ticket_events_ticket_idx on public.ticket_events (shop_id, ticket_id, created_at);
create index ticket_events_actor_idx on public.ticket_events (actor_id);
alter table public.ticket_events enable row level security;
grant select on public.ticket_events to authenticated;
create policy ticket_events_select_members on public.ticket_events
  for select to authenticated
  using (shop_id = any ((select private.my_shop_ids())::uuid[]));

create function private.ticket_event(p_shop_id uuid, p_ticket_id uuid, p_type public.ticket_event_type, p_data jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.ticket_events (shop_id, ticket_id, type, actor_id, data)
  values (p_shop_id, p_ticket_id, p_type, (select auth.uid()), coalesce(p_data, '{}'::jsonb));
$$;

-- Edits made directly (allowed columns) are recorded on the timeline.
create function private.ticket_edit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text[] := array[]::text[];
begin
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
create trigger tickets_edit_event after update on public.tickets
  for each row execute function private.ticket_edit_event();

---------------------------------------------------------------------------
-- Photos (intake condition photos; files in the private `ticket-photos`
-- bucket under <shop_id>/<ticket_id>/<file>)
---------------------------------------------------------------------------
create table public.ticket_photos (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  ticket_id uuid not null,
  storage_path text not null unique,
  caption text check (char_length(caption) <= 200),
  uploaded_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (shop_id, ticket_id) references public.tickets (shop_id, id) on delete cascade,
  check (storage_path like shop_id::text || '/' || ticket_id::text || '/%')
);
create index ticket_photos_ticket_idx on public.ticket_photos (shop_id, ticket_id);
create index ticket_photos_uploaded_by_idx on public.ticket_photos (uploaded_by);
alter table public.ticket_photos enable row level security;
grant select, insert on public.ticket_photos to authenticated;
grant delete on public.ticket_photos to authenticated;
create policy ticket_photos_select_members on public.ticket_photos
  for select to authenticated using (shop_id = any ((select private.my_shop_ids())::uuid[]));
create policy ticket_photos_insert_members on public.ticket_photos
  for insert to authenticated with check (shop_id = any ((select private.my_shop_ids())::uuid[]) and uploaded_by = (select auth.uid()));
create policy ticket_photos_delete_uploader_or_admin on public.ticket_photos
  for delete to authenticated using (uploaded_by = (select auth.uid()) or (select private.has_role(shop_id, 'admin')));

create function private.ticket_photo_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ticket_event(new.shop_id, new.ticket_id, 'photo', jsonb_build_object('photo_id', new.id));
  return new;
end;
$$;
create trigger ticket_photos_event after insert on public.ticket_photos
  for each row execute function private.ticket_photo_event();

-- Storage bucket: private, images only, 10 MB max (spec §4; decision 32).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ticket-photos', 'ticket-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

-- Folder names are compared as text so an odd path is denied, never an error.
create function private.my_shop_id_texts()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(x::text), '{}') from unnest(private.my_shop_ids()) x;
$$;
revoke execute on function private.my_shop_id_texts() from public, anon, authenticated;
grant execute on function private.my_shop_id_texts() to authenticated;

create function private.is_shop_admin_text(p_shop text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
     where m.shop_id::text = p_shop and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin')
  );
$$;
revoke execute on function private.is_shop_admin_text(text) from public, anon, authenticated;
grant execute on function private.is_shop_admin_text(text) to authenticated;

create policy "ticket-photos: members read" on storage.objects
  for select to authenticated
  using (bucket_id = 'ticket-photos' and (storage.foldername(name))[1] = any ((select private.my_shop_id_texts())::text[]));
create policy "ticket-photos: members upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'ticket-photos' and (storage.foldername(name))[1] = any ((select private.my_shop_id_texts())::text[]));
create policy "ticket-photos: uploader or admin delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'ticket-photos'
    and (storage.foldername(name))[1] = any ((select private.my_shop_id_texts())::text[])
    and (owner_id = (select auth.uid())::text or private.is_shop_admin_text((storage.foldername(name))[1]))
  );

---------------------------------------------------------------------------
-- RPCs
---------------------------------------------------------------------------

-- Create or update a customer; encrypts phone/email and stores blind indexes.
create function public.save_customer(
  p_shop_id uuid,
  p_customer_id uuid default null,
  p_name text default null,
  p_phone text default null,
  p_email text default null,
  p_preferred_channel public.preferred_channel default 'sms',
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := private.normalize_phone(p_phone);
  v_email text := private.normalize_email(p_email);
  v_id uuid;
begin
  if not private.has_role(p_shop_id, 'staff') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'enter the customer''s name' using errcode = '22023';
  end if;
  if v_phone is null and v_email is null then
    raise exception 'enter a phone number or an email' using errcode = '22023';
  end if;
  if p_customer_id is null then
    insert into public.customers (shop_id, name, phone_encrypted, phone_hash, email_encrypted, email_hash, preferred_channel, notes)
    values (p_shop_id, btrim(p_name), private.pii_encrypt(v_phone), private.blind_index(p_shop_id, v_phone),
            private.pii_encrypt(v_email), private.blind_index(p_shop_id, v_email),
            case when v_phone is null then 'email' when v_email is null then 'sms' else p_preferred_channel end,
            nullif(btrim(p_notes), ''))
    returning id into v_id;
  else
    update public.customers set
      name = btrim(p_name),
      phone_encrypted = private.pii_encrypt(v_phone), phone_hash = private.blind_index(p_shop_id, v_phone),
      email_encrypted = private.pii_encrypt(v_email), email_hash = private.blind_index(p_shop_id, v_email),
      preferred_channel = case when v_phone is null then 'email' when v_email is null then 'sms' else p_preferred_channel end,
      notes = nullif(btrim(p_notes), '')
    where id = p_customer_id and shop_id = p_shop_id
    returning id into v_id;
    if v_id is null then
      raise exception 'customer not found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

-- Decrypted contact details for customers of the caller's shops.
create function public.customer_contacts(p_customer_ids uuid[])
returns table (customer_id uuid, phone text, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, private.pii_decrypt(c.phone_encrypted), private.pii_decrypt(c.email_encrypted)
    from public.customers c
   where c.id = any (p_customer_ids)
     and c.shop_id = any (private.my_shop_ids());
$$;

-- Global search (spec §7.3): ticket number, customer name, exact phone or
-- email through the blind index.
create function public.search_shop(p_shop_id uuid, p_query text)
returns table (kind text, id uuid, label text, sublabel text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q text := btrim(coalesce(p_query, ''));
  v_num integer;
  v_phone text;
  v_email text;
begin
  if not private.has_role(p_shop_id, 'staff') or length(q) < 2 then
    return;
  end if;
  if q ~ '^#?\d{1,9}$' then
    v_num := replace(q, '#', '')::integer;
    return query
      select 'ticket', t.id, '#' || t.ticket_number || ' · ' || t.item_name, c.name
        from public.tickets t join public.customers c on c.id = t.customer_id
       where t.shop_id = p_shop_id and t.ticket_number = v_num and t.deleted_at is null;
  end if;
  begin
    v_phone := private.normalize_phone(q);
  exception when others then
    v_phone := null;
  end;
  begin
    v_email := case when q like '%@%' then private.normalize_email(q) end;
  exception when others then
    v_email := null;
  end;
  return query
    select 'customer', c.id, c.name, 'Matched by phone or email'
      from public.customers c
     where c.shop_id = p_shop_id and c.archived_at is null
       and ((v_phone is not null and c.phone_hash = private.blind_index(p_shop_id, v_phone))
         or (v_email is not null and c.email_hash = private.blind_index(p_shop_id, v_email)))
    union all
    (select 'customer', c.id, c.name, null
       from public.customers c
      where c.shop_id = p_shop_id and c.archived_at is null and c.name ilike '%' || replace(replace(q, '%', ''), '_', '') || '%'
      order by c.name
      limit 8);
end;
$$;

-- New ticket (spec §7.2). Allocates the next per-shop number under a row lock
-- on the shop (no duplicates under concurrency), starts in the first status,
-- records terms acceptance and an optional encrypted passcode.
create function public.create_ticket(
  p_shop_id uuid,
  p_customer_id uuid,
  p_item_name text,
  p_issue_description text default null,
  p_item_description text default null,
  p_promised_date date default null,
  p_assigned_to uuid default null,
  p_custom_fields jsonb default '{}'::jsonb,
  p_passcode text default null,
  p_terms_accepted boolean default false
)
returns table (ticket_id uuid, ticket_number integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number integer;
  v_status uuid;
  v_id uuid;
begin
  if not private.has_role(p_shop_id, 'staff') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.customers c where c.id = p_customer_id and c.shop_id = p_shop_id) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  update public.shops set next_ticket_number = next_ticket_number + 1
   where id = p_shop_id
   returning next_ticket_number - 1 into v_number;
  select s.id into v_status from public.statuses s where s.shop_id = p_shop_id order by s.position limit 1;
  if v_status is null then
    raise exception 'the shop has no statuses' using errcode = '22023';
  end if;
  insert into public.tickets (shop_id, ticket_number, customer_id, item_name, item_description, issue_description,
                              status_id, assigned_to, promised_date, custom_fields, passcode_encrypted,
                              terms_accepted_at, created_by)
  values (p_shop_id, v_number, p_customer_id, btrim(p_item_name), nullif(btrim(p_item_description), ''),
          nullif(btrim(p_issue_description), ''), v_status, p_assigned_to, p_promised_date,
          coalesce(p_custom_fields, '{}'::jsonb), private.pii_encrypt(nullif(p_passcode, '')),
          case when p_terms_accepted then now() end, (select auth.uid()))
  returning id into v_id;
  perform private.ticket_event(p_shop_id, v_id, 'created', jsonb_build_object('number', v_number));
  if nullif(p_passcode, '') is not null then
    perform private.ticket_event(p_shop_id, v_id, 'passcode_set');
  end if;
  return query select v_id, v_number;
end;
$$;

-- Move a ticket to another status. Moving into the final ("Picked up")
-- status purges the passcode (spec §4) and stamps picked_up_at.
create function public.set_ticket_status(p_ticket_id uuid, p_status_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tickets;
  s_old public.statuses;
  s_new public.statuses;
begin
  select * into t from public.tickets where id = p_ticket_id and deleted_at is null for update;
  if not found or not private.has_role(t.shop_id, 'staff') then
    raise exception 'ticket not found' using errcode = 'P0002';
  end if;
  select * into s_new from public.statuses where id = p_status_id and shop_id = t.shop_id;
  if not found then
    raise exception 'status not found' using errcode = 'P0002';
  end if;
  if s_new.id = t.status_id then
    return;
  end if;
  select * into s_old from public.statuses where id = t.status_id;
  update public.tickets set
    status_id = s_new.id,
    status_changed_at = now(),
    picked_up_at = case when s_new.is_final then now() else null end,
    passcode_encrypted = case when s_new.is_final then null else passcode_encrypted end
  where id = t.id;
  perform private.ticket_event(t.shop_id, t.id, 'status_change',
    jsonb_build_object('from', s_old.name, 'to', s_new.name, 'to_category', s_new.category));
  if s_new.is_final and t.passcode_encrypted is not null then
    perform private.ticket_event(t.shop_id, t.id, 'passcode_purged');
  end if;
end;
$$;

-- Set or replace a device passcode (any member).
create function public.set_ticket_passcode(p_ticket_id uuid, p_passcode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tickets;
begin
  select * into t from public.tickets where id = p_ticket_id and deleted_at is null for update;
  if not found or not private.has_role(t.shop_id, 'staff') then
    raise exception 'ticket not found' using errcode = 'P0002';
  end if;
  update public.tickets set passcode_encrypted = private.pii_encrypt(nullif(p_passcode, '')) where id = t.id;
  perform private.ticket_event(t.shop_id, t.id, case when nullif(p_passcode, '') is null then 'passcode_purged' else 'passcode_set' end);
end;
$$;

-- Reveal a passcode: Owner, Admin, or the assigned staff member; always
-- audited and on the timeline (spec §4).
create function public.reveal_passcode(p_ticket_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tickets;
begin
  select * into t from public.tickets where id = p_ticket_id and deleted_at is null;
  if not found or not private.has_role(t.shop_id, 'staff') then
    raise exception 'ticket not found' using errcode = 'P0002';
  end if;
  if not (private.has_role(t.shop_id, 'admin') or t.assigned_to = (select auth.uid())) then
    raise exception 'only the owner, admins or the assigned staff member can reveal the passcode' using errcode = '42501';
  end if;
  if t.passcode_encrypted is null then
    return null;
  end if;
  perform private.audit(t.shop_id, 'passcode.revealed', 'tickets', t.id, null, jsonb_build_object('ticket_number', t.ticket_number));
  perform private.ticket_event(t.shop_id, t.id, 'passcode_revealed');
  return private.pii_decrypt(t.passcode_encrypted);
end;
$$;

-- Add a note to the timeline.
create function public.add_ticket_note(p_ticket_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tickets;
begin
  select * into t from public.tickets where id = p_ticket_id and deleted_at is null;
  if not found or not private.has_role(t.shop_id, 'staff') then
    raise exception 'ticket not found' using errcode = 'P0002';
  end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null or length(p_body) > 2000 then
    raise exception 'write a note of up to 2000 characters' using errcode = '22023';
  end if;
  perform private.ticket_event(t.shop_id, t.id, 'note', jsonb_build_object('body', btrim(p_body)));
end;
$$;

-- Delete a ticket: Owner/Admin, soft delete with an audit row (decision P4).
create function public.delete_ticket(p_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tickets;
begin
  select * into t from public.tickets where id = p_ticket_id and deleted_at is null for update;
  if not found or not private.has_role(t.shop_id, 'staff') then
    raise exception 'ticket not found' using errcode = 'P0002';
  end if;
  if not private.has_role(t.shop_id, 'admin') then
    raise exception 'only the owner or an admin can delete tickets' using errcode = '42501';
  end if;
  update public.tickets set deleted_at = now(), passcode_encrypted = null where id = t.id;
  perform private.audit(t.shop_id, 'ticket.deleted', 'tickets', t.id,
    jsonb_build_object('ticket_number', t.ticket_number, 'item_name', t.item_name, 'customer_id', t.customer_id), null);
  perform private.ticket_event(t.shop_id, t.id, 'deleted');
end;
$$;

revoke execute on function
  private.validate_ticket(), private.ticket_event(uuid, uuid, public.ticket_event_type, jsonb),
  private.ticket_edit_event(), private.ticket_photo_event(),
  public.save_customer(uuid, uuid, text, text, text, public.preferred_channel, text),
  public.customer_contacts(uuid[]),
  public.search_shop(uuid, text),
  public.create_ticket(uuid, uuid, text, text, text, date, uuid, jsonb, text, boolean),
  public.set_ticket_status(uuid, uuid),
  public.set_ticket_passcode(uuid, text),
  public.reveal_passcode(uuid),
  public.add_ticket_note(uuid, text),
  public.delete_ticket(uuid)
from public, anon, authenticated;
grant execute on function
  public.save_customer(uuid, uuid, text, text, text, public.preferred_channel, text),
  public.customer_contacts(uuid[]),
  public.search_shop(uuid, text),
  public.create_ticket(uuid, uuid, text, text, text, date, uuid, jsonb, text, boolean),
  public.set_ticket_status(uuid, uuid),
  public.set_ticket_passcode(uuid, text),
  public.reveal_passcode(uuid),
  public.add_ticket_note(uuid, text),
  public.delete_ticket(uuid)
to authenticated;
