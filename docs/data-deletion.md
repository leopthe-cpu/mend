# Deleting a shop's data

Spec §4 asks for "a documented way to delete a shop's data". Decision 58.

## The normal way: the Owner does it in the app

1. Settings → **Your data** → (optionally) download everything first.
2. **Delete shop** → type the shop's name → enter the password (and the
   authenticator code if two-step sign-in is on) → **Delete shop forever**.

What happens, in order:

1. The app deletes every file the shop has in Storage through the Storage API:
   intake photos (`ticket-photos/<shop_id>/…`) and the logo
   (`shop-logos/<shop_id>/…`). Supabase refuses to delete Storage files with
   SQL, so this can't be done inside the database.
2. `public.delete_shop(shop_id, typed_name)` checks: the caller is the Owner,
   signed in with a password in the last 10 minutes (plus MFA if enrolled), the
   name matches (case and outer spaces ignored), and **no files are left**. It
   then deletes the shop row; every table cascades from it.
3. The Owner is signed out. Team members keep their Mend logins but no longer
   belong to the shop.

The shop's audit log is deleted with it. The deletion itself is written to the
Postgres log (`mend: shop … deleted by user …`), visible in Supabase → Logs.

If step 1 fails part-way, nothing in the database has changed yet; running the
delete again finishes the job.

## If the Owner can't (lost access, a request by email)

Only someone with the Supabase dashboard can do this, and only after
confirming the request really comes from the shop's Owner.

1. Find the shop: `select id, name from public.shops where name ilike '%…%';`
2. Delete its files in Supabase → Storage: the folder named after the shop id
   in **ticket-photos** and in **shop-logos**.
3. In the SQL editor: `delete from public.shops where id = '<shop id>';`
4. Write down who asked, when, and what was deleted.

## Not covered

- Deleting a person's Mend **account** (their login): Supabase → Authentication
  → Users. Not offered in the app yet.
- Backups: Supabase keeps database backups for a while depending on the plan;
  deleted data stays in those until they expire. Check the current plan's
  backup retention before promising a deadline to anyone.
