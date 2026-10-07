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

## To turn on texts (Twilio) — start early, verification takes days

1. Create a Twilio account and buy **one toll-free number** (US/Canada).
2. Submit **toll-free verification** for it. You'll need your business details (from Feb 2026, a business registration number unless you're a sole proprietor), sample messages (use the Ready text from Settings → Messages), and live **privacy policy and terms URLs** (separate pages). I couldn't open Twilio's pages from here, so follow what Twilio's form asks (docs/verification.md T1, T2).
3. On the number's messaging settings, set **"A message comes in"** to webhook `https://zasagjabtifpuhayttki.supabase.co/functions/v1/twilio-webhook` (HTTP POST).
4. In Supabase → Edge Functions → Secrets, add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_SENDER` (the number as +1…). Values from your Twilio console; don't paste them in chat.
5. Test: text a ticket to your own phone, reply STOP, then check the customer page shows "Opted out". Tell Claude the result (the STOP field names couldn't be verified here).

## To turn on customer emails (Resend) — after the Resend steps above

1. In Supabase → Edge Functions → Secrets, add `RESEND_API_KEY` and `MAIL_FROM_ADDRESS` (an address on your verified domain).
2. In Resend → Webhooks, add `https://zasagjabtifpuhayttki.supabase.co/functions/v1/resend-webhook` with the email events (sent, delivered, bounced, complained, failed, suppressed), then add its signing secret as `RESEND_WEBHOOK_SECRET` in Supabase.
3. Test: email a ticket to yourself; the ticket should show "Delivered" within a minute.

## Decide

- Message limits (decision 44): 500 texts per shop per month, 30 messages per 10 minutes, 5 per ticket per hour. Change any of these?
- Decision 48: I set two public values in Supabase Vault directly (not via a migration) so the scheduled sender works. OK?

## Before real shops use Mend

- Read the security review (private copy, decision 65) §2 (known gaps) and §3 (needs a lawyer).
- Decide the passcode-reveal limit (decision 60: 30 per person per hour) and how long to keep closed tickets, photos and messages.
- Consider a longer minimum password (8+) in Supabase → Authentication → Passwords.

- Decide on Supabase Pro: no pausing after 7 inactive days, downloadable backups, support, test branches, leaked-password checking. Check the current price at supabase.com/pricing.
- Turn on two-step sign-in for your own Supabase and GitHub accounts.
