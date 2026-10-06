# Decision log

Every decision made on Oz's behalf (addendum §4). **Status:** `decided` (made and in effect; Oz can still reverse it), `proposed` (waiting on Oz), `approved` (Oz agreed).

| # | Date | Decision | Reason | Alternatives considered | Status |
|---|---|---|---|---|---|
| 1 | 2026-10-05 | Build on Lovable + **an external Supabase project Oz owns** (`mend`, ca-central-1), not Lovable Cloud or Base44. | The spec depends on migrations, pgTAP in CI, the advisors and region choice, and that is easiest to guarantee on a Supabase project you own. No lock-in. | Lovable Cloud (control over CLI, tests and region not verified); Base44 (no Postgres RLS or SQL migrations; security model would need rework). | approved (Oz) |
| 2 | 2026-10-05 | **Keep Lovable's TanStack Start template** instead of restructuring it into a plain Vite SPA. | It's Lovable's current default; replacing it would break editing in Lovable. Server functions give a second server-side place for validation. | Rewrite as a Vite SPA (fights the template). | approved (Oz, 2026-10-06) |
| 3 | 2026-10-05 | Phase 0 docs committed straight to `main`, the branch Lovable syncs. | Docs only, no app code. You said "lets build it" after I suggested this. | Separate review branch + PR. | decided |
| 4 | 2026-10-05 | The spec is kept in `docs/spec.md` with the tables re-formatted as Markdown; the wording is unchanged. | The paste had flattened the tables into one cell per line. | Raw paste. | decided |

## Defaults (addendum §6) — approved by Oz on 2026-10-06 ("fine with your changes")

| # | Question | Proposed default | Why | Alternatives |
|---|---|---|---|---|
| P1 | Rounding mode | **Half away from zero**, to the cent, with exact arithmetic (Postgres `numeric`, never floats). | It's your proposal, matches what customers expect on receipts, and Postgres `round(numeric)` already does this (tested in Postgres 17: `round(2.5)=3`, `round(-2.5)=-3`, `round(0.125,2)=0.13`). Note `round(float8)` gives `2` (half-even), so never use floats. A pgTAP test will pin it. | Banker's rounding (half-even). |
| P2 | Tax rounding | **Once per tax rate per estimate:** add up the discounted line totals that carry each rate, multiply by the rate, round once. Store the unrounded per-line tax for display only. | Avoids tiny "penny drift" on multi-line invoices and is the usual invoice practice in Canada, though accounting should confirm. The Phase 3 test case gives $49.01 either way, so I'll add a test case where the two methods differ, to pin it. | Round per line, then add up. |
| P3 | Fixed discount | Comes off the **whole line** (not per unit), and is capped at the line subtotal. | That's how spec §7.8 reads. A test will assert it. | Per unit. |
| P4 | Ticket deletion | **Soft delete** (`deleted_at`), plus an audit row with the old values. Soft-deleted tickets are hidden everywhere; numbers are never reused. | Payments, messages and photos reference tickets, so a hard delete would orphan or cascade them. Soft delete also keeps "delete" reversible. Truly removing personal data is handled by the Phase 5 shop-deletion process. | Hard delete + audit row. |
| P5 | When the shop is created | **By one RPC at the end of onboarding.** Signup only creates the auth user. The shop name and the person's name are kept in signup metadata **only to pre-fill** onboarding, never used for authorization. | One atomic transaction (addendum §8), and no half-made shops when someone drops out of onboarding. | Create the shop at signup and fill it in later. |
| P6 | New-ticket shortcut | **`N`** when focus isn't in a text field, plus **Ctrl/Cmd+K** for search (already in the spec). | One key, easy at the counter, and it doesn't clash with browser shortcuts. | Ctrl/Cmd+Shift+N (Chrome uses Ctrl/Cmd+Shift+N for incognito). |
| P7 | Small claim-tag label | **2.25 × 1.25 in (57 × 32 mm)**, plus US Letter. | A common thermal-label size (I haven't checked against specific printer models). Which printer do shops use? | 2 × 1 in; 4 × 6 in shipping label. |
| P8 | Waiting/warning amber and Overdue/danger red | **Keep them shared.** Status colors always come with a label and icon, and system feedback appears in toasts and forms, not on board cards, so they never sit side by side. | Fewer tokens; meaning comes from context and label. | Separate warning `#FB923C` (orange) and danger `#EF4444`; I'd check contrast in 1A first. |
| P9 | `catalog_item_tax_rates` join table (addendum §7) | **Accept.** | Foreign keys stay enforceable, and archived tax rates can't silently linger in arrays. | Keep a `tax_rate_ids uuid[]` column. |
| P10 | Email provider | **Resend** (initial choice). | Lovable has a built-in connector, and it's commonly used as Supabase custom SMTP. **I couldn't open either vendor's docs here**, so I'll verify domain auth and webhook signing before Phase 4. | Postmark (known for transactional deliverability; not verified either). |

## Approved with the Phase 1A plan (2026-10-06)

| # | Date | Decision | Status |
|---|---|---|---|
| 5 | 2026-10-06 | Migrations reach production through Supabase's GitHub integration ("Deploy to production" from `main`), set up by Oz in the Supabase dashboard. CI only runs tests against a throwaway local database. | approved |
| 6 | 2026-10-06 | Colors: Oz's hex values are the source of truth, written as comments next to the converted oklch values in `src/styles.css` (Lovable's convention). | approved |
| 7 | 2026-10-06 | Build on Supabase Free; move to Pro before launch (leaked-password protection, backups, no pausing). | approved |
| 8 | 2026-10-06 | Connect the Supabase project in Lovable only when needed for the preview; never use Lovable's AI for database changes. | approved |
| 9 | 2026-10-06 | Assets: `public/brand/mend-wordmark.png` (primary logo, white wordmark with cyan details, transparent PNG 456×176) and `public/brand/mend-badge.png` (oval badge variant, 608×264). Photos `public/images/phone-repair-night.webp` and `public/images/tailor-and-cleaners-winter.webp` (2000×2000). The composite mock is kept as a design reference in `docs/design/` and not shipped. An SVG logo is still preferred (spec §8.1): the PNG is sharp up to about 150 px wide on retina screens. | decided |

## Decided during Phase 1A (2026-10-06)

| # | Date | Decision | Reason | Alternatives | Status |
|---|---|---|---|---|---|
| 10 | 2026-10-06 | **Password rule:** 12+ characters with lowercase, uppercase and a digit (Supabase `lower_upper_letters_digits`); symbols not required. | Spec asked for 12+. Requiring all classes plus symbols makes life hard for the less technical users the spec describes; length matters more. | Add symbols; or length only. | decided |
| 11 | 2026-10-06 | **Email must be confirmed before any login** (Supabase "Confirm email" on). | Simplest way to guarantee "verified before sending messages" (spec §4), with no half-verified state to handle. | Allow login, block only messaging until verified. | decided |
| 12 | 2026-10-06 | **PKCE auth flow**, and `secure_password_change` on. | Codes in the query string are exchanged once on our pages; no tokens in URL fragments. | Implicit flow (supabase-js default). | decided |
| 13 | 2026-10-06 | `/app` and the auth pages render **in the browser only** (`ssr: false`); auth forms are `method="post"`. | The session lives in the browser. Server-rendered forms submitted before hydration would GET the password into the URL (found while testing). | Cookie-based SSR auth with `@supabase/ssr` (more moving parts; revisit if we need server-rendered app pages). | decided |
| 14 | 2026-10-06 | New token `--mend-input-border` `#6A6AA0` for form controls; status colors used for icons/dots, labels in `--mend-text`. | `#2C2C5A` borders are about 1.3:1 (form controls need 3:1); `#64748B` closed-grey fails as text. Your palette is otherwise unchanged. | Lighten `--border` everywhere (heavier look); change the closed grey. | decided |
| 15 | 2026-10-06 | Nav collapses to icons below 1280 px, drawer below 768 px. | Tablets at the counter get more room; phones get the standard drawer. | Always expanded on tablets. | decided |
| 16 | 2026-10-06 | Interim landing page at `/` (hero photo, tagline, Get started/Log in) and draft privacy/terms pages. | Needed as entry points now, and Twilio needs live legal URLs (T1). The full landing page is still Phase 5. | Blank page until Phase 5. | decided |

## Oz's feedback (2026-10-06)

| # | Date | Decision | Status |
|---|---|---|---|
| 17 | 2026-10-06 | **Signup asks only for email and password.** Shop name and the person's name are asked later, in onboarding (Phase 1B), and **both can be skipped**. A skipped shop name gets an auto-generated, friendly positive name (e.g. "Happy Shop", "Sunny Workshop") that can be renamed any time in Settings → Shop. This replaces the signup fields in spec §5 step 1 and the "pre-fill from signup metadata" part of P5. The shop is still created by one RPC at the end of onboarding. | approved (Oz) |
| 18 | 2026-10-06 | Home page uses the tailor-shop photo; login/signup use the phone-repair photo. | approved (Oz) |
| 19 | 2026-10-06 | If the person skips their name, the app shows their email until they add one in Settings (no generated person name). | approved (Oz) |
| 20 | 2026-10-06 | The production Supabase URL and **publishable** key are committed as defaults in `src/lib/supabase-public-config.ts`; `VITE_SUPABASE_*` env vars override them (local stack, future staging). | Both values are public by design (shipped to every browser; RLS enforces access), and this makes Lovable's preview and published site work without extra setup. Secret keys stay out of the repo, enforced by the CI secret scan. | Set env vars in Lovable's settings (not verified that Lovable exposes them for this template). | decided |
| 21 | 2026-10-06 | **Light grey main view** (`#E8E9EF`, cards `#F7F7FA`, inputs white) with the **dark navy nav kept**. Inside it (`.surface-light`), buttons/links/focus are navy and "Ready" is teal `#00756F`, because cyan stays on dark surfaces only (spec §8.3). Feedback colors are darker shades. All 44 new pairs pass AA (`docs/contrast.md`). Overrides spec §8.4 "dark mode only" for the app's content area; the landing and auth pages stay dark. | approved (Oz) |
| 22 | 2026-10-06 | Larger nav: 17px labels, 22px icons, 17rem wide; user label 16px; logo 30px. | approved (Oz) |
| 10b | 2026-10-06 | **Password rule changed by Oz: 6+ characters** with lowercase, uppercase and a digit (dashboard, config.toml and forms all match). I advised 12 (spec §4, Supabase recommends 8+); Oz chose 6. | approved (Oz) |

## Phase 1B (2026-10-06): built without a separate plan review at Oz's request ("speed up")

| # | Date | Decision | Reason | Alternatives | Status |
|---|---|---|---|---|---|
| 23 | 2026-10-06 | All writes to `memberships` and `invites` go through SECURITY DEFINER functions (`create_shop`, `create_invite`, `accept_invite`, `revoke_invite`, `change_member_role`, `remove_member`, `transfer_ownership`). The Security Advisor flags each one (lint 0029) **by design**: spec §3 requires these definer RPCs, and each checks the caller's role itself (proven by `005_tenancy`). | Spec §3, §5. | Direct table writes with RLS (can't express "never grant above your own role" safely). | decided |
| 24 | 2026-10-06 | `invite_preview(token)` is callable **without signing in** (Advisor lint 0028, intended): the invite page shows shop name, role and a masked email before the invitee has an account. Invalid tokens reveal nothing; tokens are 256 random bits. | Spec §5 "invitee opens the link, sees the shop name and role". | Show details only after sign-in. | decided |
| 25 | 2026-10-06 | Ownership transfer requires a **password sign-in within the last 10 minutes** (JWT `amr`), plus `aal2` if the Owner has two-step sign-in on; the UI re-asks for the password (and code). | Spec §4 "re-entering the password (and MFA when enabled)", enforced in the database, not just the UI. | UI-only confirmation. | decided |
| 26 | 2026-10-06 | MVP: **one shop per user**, enforced in `create_shop` and `accept_invite` (the schema allows many later). | Spec §5. | | decided |
| 27 | 2026-10-06 | Invites: **20 per shop per 24 h**; a new invite to the same email revokes the pending one. Invite links are **copied and sent by the shop for now**; Mend emails them once email sending exists (Phase 4). | Spec §4 rate limits; no email provider yet. | Supabase's built-in invite email (heavily rate-limited, generic). | decided |
| 28 | 2026-10-06 | Onboarding is 4 short steps: names (skippable) → trade → location, phone, pickup hours → taxes (optional). **Logo upload and business-hours grid deferred**: pickup hours are free text (`business_hours.text`), used for `{pickup_hours}`. No tax presets: rates change (e.g. provincial HST) and I won't hard-code numbers I can't verify; the owner types them. | Speed and accuracy; logo needs Storage policies (Phase 2 builds those for photos). | Province presets; weekly hours grid. | decided |
| 29 | 2026-10-06 | Two-step sign-in (TOTP) is **offered to Owners and Admins** (spec §4); once enrolled, the app requires it (`aal2`) on every login. | Spec §4, addendum §10. | Offer to Staff too. | decided |
| 30 | 2026-10-06 | Profiles now carry the sign-in **email**, visible to coworkers in the same shop only, so the team page can tell people apart. | Names are optional (decision 19). | Show only names. | decided |
| 31 | 2026-10-06 | Starter seeds per trade follow spec §7.1 exactly; "Ready" gets SMS + email templates and notifies by default; binding settings carry the safety note; status colours map to the status tokens. | Spec §7.1. | | decided |
