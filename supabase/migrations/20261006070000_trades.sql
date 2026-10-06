-- Brand rework (decision 52): the website speaks to cobblers, leather artisans
-- and watchmakers, so those trades get their own setup. The existing trades
-- stay (shops already use them, and an enum value can't be dropped safely).
--
-- Kept in its own file: a new enum value can't be USED in the transaction that
-- adds it. Nothing here uses them; the seed functions in the next migration
-- only compare text at run time.
alter type public.shop_vertical add value if not exists 'shoe_leather';
alter type public.shop_vertical add value if not exists 'watch';
