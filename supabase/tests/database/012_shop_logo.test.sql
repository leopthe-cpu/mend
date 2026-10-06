-- Shop logo (decision 57): Owner/Admin upload and set it, every member can
-- read it, other shops can't, and the path must be this shop's own file.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('f5000000-0000-0000-0000-000000000001', 'owner@p.test', now(), '{}'),
  ('f5000000-0000-0000-0000-000000000002', 'staff@p.test', now(), '{}'),
  ('f6000000-0000-0000-0000-000000000001', 'owner@q.test', now(), '{}');
create temp table t (k text primary key, v text);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select v::uuid from t where k = p $$;
grant execute on function pg_temp.v(text) to authenticated;

select set_config('request.jwt.claims', '{"sub":"f5000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('shop', public.create_shop('P Shoes', null, 'shoe_leather', 'CA', null, 'America/Toronto')::text);
reset role;
insert into public.memberships (shop_id, user_id, role) values (pg_temp.v('shop'), 'f5000000-0000-0000-0000-000000000002', 'staff');
select set_config('request.jwt.claims', '{"sub":"f6000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('other', public.create_shop('Q Watches', null, 'watch', 'CA', null, 'America/Toronto')::text);
reset role;

-- Staff can't upload; the owner can.
select set_config('request.jwt.claims', '{"sub":"f5000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(format($$ insert into storage.objects (bucket_id, name, owner_id) values ('shop-logos', '%s/staff.png', 'f5000000-0000-0000-0000-000000000002') $$, pg_temp.v('shop')),
  '42501', null, 'staff cannot upload a logo');
reset role;
select set_config('request.jwt.claims', '{"sub":"f5000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(format($$ insert into storage.objects (bucket_id, name, owner_id) values ('shop-logos', '%s/abc123.png', 'f5000000-0000-0000-0000-000000000001') $$, pg_temp.v('shop')),
  'owner uploads a logo');
select throws_ok(format($$ insert into storage.objects (bucket_id, name, owner_id) values ('shop-logos', '%s/evil.png', 'f5000000-0000-0000-0000-000000000001') $$, pg_temp.v('other')),
  '42501', null, 'cannot upload into another shop''s folder');
select throws_ok(format($$ select public.set_shop_logo('%s', '%s/missing.png') $$, pg_temp.v('shop'), pg_temp.v('shop')),
  'P0002', null, 'the file must exist');
select throws_ok(format($$ select public.set_shop_logo('%s', '%s/../x.png') $$, pg_temp.v('shop'), pg_temp.v('shop')),
  '22023', null, 'odd paths are refused');
select throws_ok(format($$ select public.set_shop_logo('%s', '%s/abc123.png') $$, pg_temp.v('shop'), pg_temp.v('other')),
  '22023', null, 'the path must be in this shop''s folder');
select is(public.set_shop_logo(pg_temp.v('shop'), pg_temp.v('shop') || '/abc123.png'), null, 'logo set (no previous one)');
reset role;
select is((select logo_path from public.shops where id = pg_temp.v('shop')), pg_temp.v('shop') || '/abc123.png', 'logo_path saved');
select ok(exists (select 1 from public.audit_log where shop_id = pg_temp.v('shop') and action = 'shops.update'
                    and new_values ->> 'logo_path' is not null), 'logo change audited');

-- Staff can read it but not change it; another shop sees nothing.
select set_config('request.jwt.claims', '{"sub":"f5000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id = 'shop-logos'), 1, 'staff can read the logo file');
select throws_ok(format($$ select public.set_shop_logo('%s', null) $$, pg_temp.v('shop')), '42501', null, 'staff cannot change the logo');
reset role;
select set_config('request.jwt.claims', '{"sub":"f6000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id = 'shop-logos'), 0, 'other shops cannot read it');
select throws_ok(format($$ select public.set_shop_logo('%s', null) $$, pg_temp.v('shop')), '42501', null, 'other shops cannot change it');
reset role;

-- Clearing returns the old path for cleanup.
select set_config('request.jwt.claims', '{"sub":"f5000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.set_shop_logo(pg_temp.v('shop'), null), pg_temp.v('shop') || '/abc123.png', 'clearing returns the old path');
select throws_ok(format($$ update public.shops set logo_path = 'x' where id = '%s' $$, pg_temp.v('shop')),
  '42501', null, 'logo_path is not directly writable');
reset role;

select * from finish();
rollback;
