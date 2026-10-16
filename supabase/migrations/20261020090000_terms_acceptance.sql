-- Record which version of the terms and privacy policy each user accepted, and
-- when (docs/legal-compliance.md §3.1 consent, §7 item 2). The version string
-- is src/lib/legal.ts LEGAL.version.
--
-- Two ways in:
-- - Sign-up: the form sends terms_version in the signup metadata, and the
--   new-user trigger copies it with the time. Like full_name, the metadata is
--   the user's own claim; it only records their own acceptance.
-- - public.accept_terms(version): a signed-in user accepts a newer version
--   (the app asks when LEGAL.version changes).
-- The columns are not client-writable (profiles only grants update(full_name)).

alter table public.profiles
  add column terms_version text check (char_length(terms_version) <= 50),
  add column terms_accepted_at timestamptz;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_terms text := nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'terms_version', '')), 50), '');
begin
  insert into public.profiles (user_id, full_name, email, terms_version, terms_accepted_at)
  values (
    new.id,
    left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 200),
    lower(new.email),
    v_terms,
    case when v_terms is not null then now() end
  );
  return new;
end;
$$;

create function public.accept_terms(p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_version text := btrim(coalesce(p_version, ''));
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if char_length(v_version) not between 1 and 50 then
    raise exception 'unknown terms version' using errcode = '22023';
  end if;
  update public.profiles set terms_version = v_version, terms_accepted_at = now() where user_id = v_uid;
end;
$$;

revoke execute on function public.accept_terms(text) from public, anon, authenticated;
grant execute on function public.accept_terms(text) to authenticated;
