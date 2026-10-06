# Oz's to-do list

Things only Oz can do (accounts, payments, DNS). Claude keeps this list up to date.

## Tomorrow: connect Resend so sign-up emails work for everyone

Why: Supabase's built-in email sender only delivers to members of your Supabase
team and is capped at a few emails per hour. That is the "too many attempts"
error on sign-up. Upgrading the Supabase plan does not change this; only your
own email provider does (Supabase docs: "Send emails with custom SMTP").

1. Create a Resend account (resend.com). The free tier is enough to start; check its current limits on their pricing page.
2. Add a domain you own in Resend (for example `mail.yourdomain.com`) and add the DNS records it shows you at your domain registrar. Wait until Resend shows the domain as verified.
3. In Resend, create an API key with sending access only. Don't paste it in chat or in the code.
4. In Supabase: Authentication → Emails → SMTP settings → enable custom SMTP and fill in:
   - Host, port and username: copy them from Resend's SMTP page (verify there; don't trust these notes for the values).
   - Password: the API key from step 3.
   - Sender email: an address on your verified domain, e.g. `hello@mail.yourdomain.com`.
   - Sender name: `Mend`.
5. In Resend, turn **off** link/click tracking for this domain. Supabase warns that tracking can break the confirmation links.
6. In Supabase: Authentication → Rate Limits → raise "emails per hour" from 30 to what you need (e.g. 100 while testing).
7. Test: sign up with a brand-new address that isn't on your Supabase team, then confirm the email arrives and the link logs you in.
8. Tell Claude when done. Phase 4 will reuse the same Resend account for customer emails.

## Before real shops use Mend

- Decide on Supabase Pro: no pausing after 7 inactive days, downloadable backups, support, test branches, leaked-password checking. Check the current price at supabase.com/pricing.
- Turn on two-step sign-in for your own Supabase and GitHub accounts.
