# Oz's to-do list

Things only Oz can do (accounts, payments, DNS, decisions, testing). Claude
keeps this list up to date. Order and status: [launch-plan.md](launch-plan.md).

## This week: test the product (staging, then production)

On https://mend-staging.up.railway.app (hard-refresh first), then again on
www.mendshops.com after the release:

1. Phone (iPhone Safari), iPad and a laptop: Board, Calendar (week and
   month), List, a ticket, Customers, Catalog, Messages, Settings. Nothing
   should be cut off or make the page slide sideways.
2. New ticket from the top bar, the N key and the + on the first column.
3. Drag a card between columns (Chrome and Safari on the Mac).
4. Sign up with a brand-new email and reset a password: both emails arrive
   and their links open the right site (staging links → staging; production
   links → mendshops.com). This checks the Supabase Auth URLs, which Claude
   can't see.
5. Texts (trial number, your own verified phone): send a Ready text, reply
   STOP, check the customer shows "Opted out", reply START.
6. Emails: email a ticket to yourself; the ticket shows "Delivered" within a
   minute.
7. Release: when staging looks right, approve and merge the `develop` →
   `main` pull request Claude opens.

## Decide (Claude's recommendation in brackets)

- Message limits (decision 44): 500 texts per shop per month, 30 messages per 10 minutes, 5 per ticket per hour. [Keep for launch.]
- Decision 48: two public values set in Supabase Vault directly (not via a migration) so the scheduled sender works. [OK.]
- Trade status lists (decision 52) and passcode reveals, 30 per person per hour (decision 60). [Keep.]
- Decisions 87 (one customer's data export) and 88 (unsubscribe footer): built and live on staging, still marked "proposed". [Accept.]
- Summary tiles (decision 114): keep the five, or add "Waiting on customer" or "Money due at pickup". [Add "Money due at pickup" later, once shops use payments.]
- Website audience: it names cobblers, leather and watch repair; tailoring, electronics and ski shops can also sign up. [Name tailors too.]

## Before talking to customers (last)

- **Plans, pricing and billing** (Oz, 21 Oct: on hold until then). Revise the
  features in each plan, the plans and their prices, and connect Stripe. Decide
  with it: customer replies (decision 107, option A or B; Claude recommends A)
  and the Pro shop logo. Until then the website keeps its current pricing
  section ($19 / $39, 14-day trial, "free while in early access"), even though
  no plans or billing exist yet.

- Legal package and lawyer review (launch-plan.md L2).
- A full day on a real phone on production (L7).
- Twilio toll-free verification (steps below). Verification takes days; check whether Twilio requires leaving the free trial first.
- Supabase Pro for backups: no pausing after 7 inactive days, downloadable backups, support, leaked-password checking. Check the current price at supabase.com/pricing.
- Minimum password length 8+ in Supabase → Authentication → Passwords (local default is 6).
- Read the security review (private copy, decision 65) §2 (known gaps) and §3 (needs a lawyer).
- Turn on two-step sign-in for your own Supabase and GitHub accounts.

## Done

- Resend: domain verified, Supabase custom SMTP, customer-email secrets and webhook (Oct 19).
- Twilio: number bought, incoming-message webhook, the three secrets (Oct 19, trial).
- Legal details on /privacy and /terms (Oct 18, `src/lib/legal.ts`): operated by
  Leonardo Thé as a sole proprietor ("operating as Mend"); contact
  `jody@mendshops.com`; mailing address 185 Crawford St, Unit 1, Toronto, ON
  M6J 2V5. They should match the Twilio submission.

## Reference: setup steps

### Resend for sign-up emails (done)

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

### Twilio texts (steps 1, 3, 4 done; step 2 verification last)

Before step 2, Claude publishes interim privacy and terms pages that pass Twilio's checks (launch-plan.md L1a). Send Claude your legal business name, mailing address and a contact email first. Order of all launch steps: [launch-plan.md](launch-plan.md).

1. Create a Twilio account and buy **one toll-free number** (US/Canada).
2. Submit **toll-free verification** for it. You'll need your business details (from Feb 2026, a business registration number unless you're a sole proprietor), sample messages (use the Ready text from Settings → Messages), and live **privacy policy and terms URLs** (separate pages). I couldn't open Twilio's pages from here, so follow what Twilio's form asks (docs/verification.md T1, T2).
3. On the number's messaging settings, set **"A message comes in"** to webhook `https://zasagjabtifpuhayttki.supabase.co/functions/v1/twilio-webhook` (HTTP POST).
4. In Supabase → Edge Functions → Secrets, add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_SENDER` (the number as +1…). Values from your Twilio console; don't paste them in chat.
5. Test: text a ticket to your own phone, reply STOP, then check the customer page shows "Opted out". Tell Claude the result (the STOP field names couldn't be verified here).

### Customer emails (Resend) (done)

1. In Supabase → Edge Functions → Secrets, add `RESEND_API_KEY` and `MAIL_FROM_ADDRESS` (an address on your verified domain).
2. In Resend → Webhooks, add `https://zasagjabtifpuhayttki.supabase.co/functions/v1/resend-webhook` with the email events (sent, delivered, bounced, complained, failed, suppressed), then add its signing secret as `RESEND_WEBHOOK_SECRET` in Supabase.
3. Test: email a ticket to yourself; the ticket should show "Delivered" within a minute.
