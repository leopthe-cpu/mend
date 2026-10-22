-- Main search also finds tickets by item, description and date (19 Oct
-- feedback, item 15; decision 102). Same arguments as before, so the grants
-- from 20261006030100_customers_tickets.sql stay as they are.
--
-- Order of results: ticket number, then exact phone / email, then customer
-- names, then tickets whose item, "what needs doing" or customer name matches
-- (so a name also lists that customer's tickets), then (when the
-- query is a date, YYYY-MM-DD) tickets ready by or dropped off that day in the
-- shop's time zone. The app turns "Oct 20" and similar into YYYY-MM-DD before
-- calling (src/lib/searchDate.ts). Deleted tickets and archived customers
-- never show; the caller must be staff of the shop.
create or replace function public.search_shop(p_shop_id uuid, p_query text)
returns table (kind text, id uuid, label text, sublabel text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q text := btrim(coalesce(p_query, ''));
  v_like text;
  v_num integer;
  v_phone text;
  v_email text;
  v_date date;
  v_tz text;
begin
  if not private.has_role(p_shop_id, 'staff') or length(q) < 2 then
    return;
  end if;
  -- %, _ and \ are pattern characters for ilike; drop them from the query.
  -- Nothing left (e.g. "%%") matches no name or item.
  v_like := regexp_replace(q, '[%_\\]', '', 'g');
  v_like := case when length(btrim(v_like)) < 2 then null else '%' || v_like || '%' end;
  if q ~ '^#?\d{1,9}$' then
    v_num := replace(q, '#', '')::integer;
    return query
      select 'ticket', t.id, '#' || t.ticket_number || ' · ' || t.item_name, c.name
        from public.tickets t join public.customers c on c.id = t.customer_id
       where t.shop_id = p_shop_id and t.ticket_number = v_num and t.deleted_at is null;
  end if;
  if q ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      v_date := q::date;
    exception when others then
      v_date := null;
    end;
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
      where c.shop_id = p_shop_id and c.archived_at is null and c.name ilike v_like
      order by c.name
      limit 8);
  if v_date is null then
    return query
      select 'ticket', t.id, '#' || t.ticket_number || ' · ' || t.item_name, c.name
        from public.tickets t join public.customers c on c.id = t.customer_id
       where t.shop_id = p_shop_id and t.deleted_at is null
         and (t.item_name ilike v_like or t.issue_description ilike v_like or c.name ilike v_like)
       order by t.ticket_number desc
       limit 8;
  else
    select s.time_zone into v_tz from public.shops s where s.id = p_shop_id;
    return query
      select 'ticket', t.id, '#' || t.ticket_number || ' · ' || t.item_name,
             c.name || case when t.promised_date = v_date then ' · Ready by this day'
                            else ' · Dropped off this day' end
        from public.tickets t join public.customers c on c.id = t.customer_id
       where t.shop_id = p_shop_id and t.deleted_at is null
         and (t.promised_date = v_date
           or (t.created_at at time zone v_tz)::date = v_date)
       order by t.ticket_number desc
       limit 20;
  end if;
end;
$$;
