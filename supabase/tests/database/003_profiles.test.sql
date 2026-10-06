-- profiles: users see and rename only their own row; nobody inserts/deletes
-- through the API; anon sees nothing.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.local', '{"full_name": "  Alice A  "}'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.local', '{}');

select results_eq(
  $$ select full_name from public.profiles
      where user_id = '11111111-1111-1111-1111-111111111111' $$,
  array['Alice A'],
  'signup trigger creates a profile with the trimmed metadata name'
);
select results_eq(
  $$ select full_name from public.profiles
      where user_id = '22222222-2222-2222-2222-222222222222' $$,
  array[''],
  'missing name becomes an empty string'
);

-- As user A
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);

select results_eq('select count(*) from public.profiles', array[1::bigint],
  'user A sees only their own profile');

select lives_ok(
  $$ update public.profiles set full_name = 'Alice'
      where user_id = '11111111-1111-1111-1111-111111111111' $$,
  'user A can rename themselves');

select is_empty(
  $$ update public.profiles set full_name = 'hacked'
      where user_id = '22222222-2222-2222-2222-222222222222' returning 1 $$,
  'user A cannot update user B');

select throws_ok(
  $$ update public.profiles set user_id = '22222222-2222-2222-2222-222222222222'
      where user_id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null, 'user A cannot change the user_id column');

select throws_ok(
  $$ insert into public.profiles (user_id, full_name)
     values ('33333333-3333-3333-3333-333333333333', 'x') $$,
  '42501', null, 'clients cannot insert profiles');

select throws_ok(
  $$ delete from public.profiles $$,
  '42501', null, 'clients cannot delete profiles');

-- As user B: A's rename is invisible, B's own row untouched.
select set_config('request.jwt.claims',
  '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select results_eq('select full_name from public.profiles', array[''],
  'user B sees only their own unchanged profile');

-- As anon
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok('select * from public.profiles', '42501', null,
  'anon cannot read profiles at all');

reset role;
select results_eq(
  $$ select full_name from public.profiles
      where user_id = '22222222-2222-2222-2222-222222222222' $$,
  array[''],
  'user B profile was never modified');

select * from finish();
rollback;
