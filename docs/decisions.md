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
