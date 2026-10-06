-- Team page needs to tell members apart: copy the auth email onto profiles
-- (readable by the person and their coworkers only, via existing RLS) and keep
-- it in sync when someone changes their email.

alter table public.profiles add column email text;
update public.profiles p set email = lower(u.email) from auth.users u where u.id = p.user_id;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, full_name, email)
  values (
    new.id,
    left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 200),
    lower(new.email)
  );
  return new;
end;
$$;

create function private.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = lower(new.email) where user_id = new.id;
  return new;
end;
$$;
revoke execute on function private.sync_profile_email() from public, anon, authenticated;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.sync_profile_email();
