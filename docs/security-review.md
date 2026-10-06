# Mend security review

Phase 5 (spec §9; addendum: "write the security review to
docs/security-review.md"). Written 2026-10-06 against `main`, after
migration `20261006080300`. This is an engineering review, not a legal
opinion or a penetration test.

## 1. What is enforced where

**The browser is untrusted.** It holds only the Supabase publishable (anon)
key. The UI hides what a role can't do, but every rule below is enforced on
the server, whatever the browser sends.

### Database (Postgres, Supabase)

| Area | How it's enforced | Proof |
|---|---|---|
| Tenant isolation | Row Level Security on **every** table in `public`; each policy checks membership through `private.*` helpers that read `memberships` at query time, so removing someone cuts access on the next request. | pgTAP 001 (RLS on everywhere), 005 (two shops, every role, removal) |
| Writes | Business writes go through `SECURITY DEFINER` functions (`set search_path = ''`) that check the caller's role first. Direct table writes are limited by column grants (e.g. shop settings) and RLS. | pgTAP 002: only a named allow-list of functions is callable by `authenticated`; 005–014 |
| Roles | Owner / Admin / Staff matrix (spec §5) inside the functions; exactly one Owner per shop (unique index). | pgTAP 005 |
| Customer phone and email | Encrypted with pgcrypto (AES-256) using keys in **Supabase Vault**; exact-match search through an HMAC blind index salted per shop. Only `private` functions can decrypt. | Decision 32; pgTAP 006 |
| Device passcodes | Encrypted the same way; revealed only to Owner/Admin or the assigned staff member, **audited**, **max 30 per person per hour**, and **purged when the item is picked up**. Never included in exports. | pgTAP 006, 014; decisions 56, 60 |
| Audit log | Append-only: a trigger refuses UPDATE/DELETE even for the table owner (rows go only when the whole shop is deleted). Owner/Admin can read it. | pgTAP 005 |
| Money | Totals, discounts and tax are computed in the database; invoices freeze totals and shop details. | pgTAP 008 |
| Sensitive actions | Ownership transfer, data export and shop deletion need a password sign-in within the last 10 minutes (plus the MFA code if enrolled), checked from the session token in the database. | pgTAP 005, 011, 013 |

### Authentication (Supabase Auth)

- Email + password, email confirmation required before a shop can be created.
- Password rule: **at least 6 characters** with lower case, upper case and a
  digit (Oz's choice; see gaps).
- Optional TOTP two-step sign-in (Settings → Security); when enrolled, the app
  requires it before entering.
- Changing the password needs a recent sign-in (`secure_password_change`).

### Storage

- Private buckets only: `ticket-photos` (10 MB, images) and `shop-logos`
  (2 MB, PNG/JPEG). Policies check the shop id at the start of the file path.
- Files are shown through signed links that expire after 10 minutes.
- Supabase refuses SQL deletes on Storage, so shop deletion removes files
  through the Storage API first and the database refuses while any remain.

### Edge Functions (Deno)

- `twilio-webhook`: verifies Twilio's `X-Twilio-Signature` (HMAC-SHA1 of URL +
  params) before reading anything; status updates are fetched back from Twilio
  by message SID rather than trusted from the callback (decision 45).
- `resend-webhook`: verifies the Standard Webhooks signature with the signing
  secret.
- `send-messages`: no login, by design (decision 47). It only sends messages a
  member already confirmed and that are due, with row locks, so calling it can
  neither create a message nor send one twice.
- Provider keys live only in Edge Function secrets, set by Oz; none are in the
  repo or the browser.

### Rate limits

| Action | Limit | Where |
|---|---|---|
| Sign-up, sign-in, emails | Supabase Auth rate limits | Supabase dashboard (see gaps) |
| Shops | One per user | `create_shop` |
| Invites | 20 per shop per 24 h; invite tokens are 32 random bytes, stored hashed, single use, expiring | `create_invite` |
| Messages | 30 per shop per 10 min, 5 per ticket per hour, monthly SMS cap per shop | `queue_message` (decision 44) |
| Passcode reveals | 30 per person per shop per hour | `reveal_passcode` (decision 60) |
| Export, shop deletion | Owner only, fresh password, audited (export) | decisions 56, 58 |

### Web app

- Security headers on every page in production builds: HSTS, `X-Frame-Options:
  DENY`, `nosniff`, strict referrer, Permissions-Policy, and a partial CSP
  (`frame-ancestors 'none'; base-uri 'self'; object-src 'none';
  form-action 'self'`). Decision 59.
- Spreadsheet exports neutralise formula injection.

### Data rights

- Export: Owner, Settings → Your data (decision 56).
- Deletion: Owner, Settings → Your data, plus a manual procedure
  (`docs/data-deletion.md`, decision 58).

## 2. Known gaps (in rough order of importance)

1. **Emails only reach Supabase team members** until Resend is connected as
   custom SMTP (Oz's to-do). Until then real shops can't sign up reliably.
2. **Password rules are light** (6 characters) and **leaked-password checking
   is off**. The Supabase advisor flags the latter; it appears to need a paid
   plan (not verified from here). Suggest at least 8 characters before launch.
3. **CSP doesn't restrict scripts or network calls yet.** TanStack Start puts
   inline scripts in the page, which a strict `script-src` would block without
   per-request nonces. Worth doing once hosting is settled (Cloudflare).
4. **Supabase Auth rate limits and the auth email templates** are dashboard
   settings that weren't reviewed from here. Oz to check Authentication → Rate
   Limits after Resend is connected.
5. **Backups and pausing:** on the free plan the project can pause when idle
   and backups are limited. Decide on the Pro plan before real shops use Mend
   (check current terms on supabase.com/pricing).
6. **Retention isn't decided:** closed tickets, photos, message logs and the
   audit log are kept forever. Deleted tickets are soft-deleted and keep their
   photos. Needs Oz's decision (spec §10 "needs a human decision").
7. **People with Supabase dashboard access can decrypt customer data**: the
   keys are in Vault in the same project. Keep that access to Oz, with two-step
   sign-in on Supabase and GitHub.
8. **`invite_preview` is callable without signing in** (advisor warning, by
   design: the invite page shows the shop name before the account exists). It
   needs the 64-character token and returns only shop name and role.
9. **Signed-in users can call the server functions directly** (advisor
   warnings 0029). That is the design: each function checks the caller's role
   itself, and pgTAP tests every one.
10. **Vault entries set outside migrations** (decision 48, Oz to confirm).
11. **No in-app account deletion** (only shop deletion). Supabase dashboard for
    now.
12. **Logs may contain personal data:** Edge Function and Postgres logs were not
    reviewed for phone numbers or emails. Check before launch.
13. **Pre-release dependency:** the build uses `nitro` 3.0 beta (pinned by the
    Lovable template).

## 3. Needs legal or outside review (flagged, not decided)

- Privacy policy and terms pages are **drafts**. They must be reviewed before
  real customers and before Twilio toll-free verification (which asks for live
  URLs).
- PIPEDA (Canada), CCPA and other state laws (US): what Mend must disclose,
  how long it keeps data, and how it answers access and deletion requests.
- CASL: whether "your item is ready" texts and emails count as transactional
  (likely exempt, not confirmed).
- Twilio toll-free verification requirements (docs/verification.md T1, T2).
- Mend's legal entity name ("Mend Inc." on the site is a placeholder).
- Whether shops need customer consent wording at intake for texts and emails.

## 4. How this was checked

- 14 pgTAP files, 374 database tests (local), run in CI on every push.
- 168 unit tests (Vitest), lint, typecheck and build in CI.
- Browser end-to-end scripts for sign-up, onboarding, roles and invites,
  tickets and photos, money and PDFs, messages, export, logo and shop deletion.
- Production: migrations applied by the Supabase GitHub integration; security
  and performance advisors re-run after this phase (results in section 5).
- Security headers checked on the production build under Cloudflare's local
  runtime (wrangler 4).

## 5. Advisor results (production, after Phase 5)

Run 2026-10-06 18:30 UTC, after migration `20261006080300` was live.

**Security: no errors; 3 warning types, all known.**

| Warning | Count | Status |
|---|---|---|
| 0028 Public can execute a SECURITY DEFINER function | 1 (`invite_preview`) | By design (gap 8) |
| 0029 Signed-in users can execute SECURITY DEFINER functions | 38 | By design: each checks the caller's role; covered by pgTAP (gap 9) |
| Leaked password protection disabled | 1 | Open (gap 2) |

**Performance: info only.** 28 "unused index" notices. Expected: production
holds one test shop, so most indexes have never been needed yet. They back
foreign keys and per-shop lists; keep them and re-check once real shops use
Mend.
