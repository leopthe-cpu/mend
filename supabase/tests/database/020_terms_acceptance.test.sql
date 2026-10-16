-- Terms acceptance: recorded at sign-up from metadata, re-accepted by RPC,
-- never writable directly.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('ba000000-0000-0000-0000-000000000001', 'new@terms.test', now(), '{"terms_version":"interim-2026-10-16"}'),
  ('ba000000-0000-0000-0000-000000000002', 'old@terms.test', now(), '{}');

select is((select terms_version from public.profiles where user_id = 'ba000000-0000-0000-0000-000000000001'),
  'interim-2026-10-16', 'sign-up metadata records the accepted version');
select ok((select terms_accepted_at is not null from public.profiles where user_id = 'ba000000-0000-0000-0000-000000000001'),
  'and the time');
select ok((select terms_version is null and terms_accepted_at is null from public.profiles
            where user_id = 'ba000000-0000-0000-0000-000000000002'), 'no metadata: nothing recorded');

select set_config('request.jwt.claims', '{"sub":"ba000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.accept_terms('final-2026-11-01') $$, 'a user can accept a version');
select throws_ok($$ select public.accept_terms('  ') $$, '22023', null, 'a blank version is rejected');
select throws_ok($$ update public.profiles set terms_version = 'x' where user_id = 'ba000000-0000-0000-0000-000000000002' $$,
  '42501', null, 'the columns are not directly writable');
reset role;
select is((select terms_version from public.profiles where user_id = 'ba000000-0000-0000-0000-000000000002'),
  'final-2026-11-01', 'accept_terms recorded the version');
select is((select terms_version from public.profiles where user_id = 'ba000000-0000-0000-0000-000000000001'),
  'interim-2026-10-16', 'and touched only the caller');

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$ select public.accept_terms('x') $$, '42501', null, 'anon cannot call it');
reset role;

select * from finish();
rollback;
