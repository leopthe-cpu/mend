-- Pins the money rounding rule (docs/decisions.md P1): half away from zero on
-- numeric. Floats round half-to-even, which is why money never uses floats.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);
select is(round(2.5::numeric), 3::numeric, '2.5 rounds up to 3');
select is(round(-2.5::numeric), -3::numeric, '-2.5 rounds away from zero to -3');
select is(round(0.125::numeric, 2), 0.13::numeric, '0.125 rounds to 0.13');
select is(round(2.5::float8), 2::float8, 'float8 is half-even: never use floats for money');
select * from finish();
rollback;
