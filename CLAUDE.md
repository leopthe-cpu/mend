# Mend — rules for AI assistants

Multi-tenant job tracking and customer notifications for independent repair shops (Canada and US).
**Full spec: `docs/spec.md`.** Re-read the relevant section before working on an area. Decisions: `docs/decisions.md`; what's verified: `docs/verification.md`.

Priorities, in order: **security, correctness, a clean editorial UI.**

## Working rules
- Never invent APIs, library methods, Supabase features, CLI flags or SDK syntax. Check current official docs. If you can't verify something, say so and propose an alternative.
- Work in phases (spec §9 + addendum). At the end of each phase: stop, summarize, list what's unverified or decided on Oz's behalf, wait for a go-ahead.
- Ask before deviating from the spec. Don't fill gaps with assumptions; ask one clear question.
- Record every decision made on Oz's behalf in `docs/decisions.md` (date, decision, reason, alternatives).
- Small, descriptive commits. `git pull` before starting; push when a step is done. `main` syncs to Lovable: keep it building, and never force-push or rewrite pushed history.
- **Lovable-editor guard:** if a pull brings changes to `supabase/`, RLS, RPC calls, auth or secrets handling, stop and show Oz the diff.
- Before pushing: `bun run lint`, `bunx tsc --noEmit`, `bun run test`, `bun run build`, and `supabase test db` when the database changed.

## Stack
Lovable TanStack Start template (React 19, TS strict, Vite, Tailwind v4, shadcn/ui), built for Cloudflare Workers. Supabase project `mend` (ca-central-1) owned by Oz, not Lovable Cloud. Package manager: bun.

## Database and secrets rules
- Schema changes **only** as SQL files in `supabase/migrations/`. Never edit the dashboard schema by hand.
- **RLS on every table in `public`**, deny by default, explicit policies per operation, always `to authenticated`. `anon` gets nothing. A pgTAP test enforces this.
- Tenancy: every tenant table has `shop_id`. Policies call `security definer` helpers in the **`private` schema** (never exposed), with `set search_path = ''`, wrapped as `(select private.fn(...))`.
- Functions are executable by `PUBLIC` by default: revoke from `public` and `anon`, then grant only what's needed.
- Sensitive writes (line items, discounts, overrides, payments, roles, invites, ownership transfer) go **only** through `security definer` RPCs that check role and validate input. Block direct client writes to those tables.
- Money: integer cents. Quantities: `numeric(…,2)`. Rounding: half away from zero (`round(numeric)`; never floats). Tax rounded once per rate per estimate.
- The browser only ever holds the publishable key (`VITE_SUPABASE_*`). Service-role/secret keys and provider keys live only in Edge Function secrets or CI secrets. Never commit `.env*` (except `.env.example`).
- Audit log is append-only; nobody can update or delete it.

## Permissions matrix (enforced in RLS and RPCs; the UI only hides)
| Action | Owner | Admin | Staff |
|---|---|---|---|
| Tickets: create/edit, move status, photos, notes | ✓ | ✓ | ✓ |
| Customers: create/edit, view contact info | ✓ | ✓ | ✓ |
| Send customer notifications | ✓ | ✓ | ✓ |
| Build estimates from catalog items | ✓ | ✓ | ✓ |
| Record payments | ✓ | ✓ | ✓ |
| One-off custom line items | ✓ | ✓ | ✗ |
| Override catalog price on a ticket | ✓ | ✓ | ✗ |
| Apply/edit/remove line-item discounts | ✓ | ✓ | ✗ (read-only) |
| Edit/delete payments, delete tickets | ✓ | ✓ | ✗ |
| Reveal device passcodes (audited) | ✓ | ✓ | assigned staff only |
| Shop settings, statuses, custom fields, templates, taxes | ✓ | ✓ | ✗ |
| Invite and remove Staff | ✓ | ✓ | ✗ |
| View audit log | ✓ | ✓ | ✗ |
| Catalog items and catalog discounts | ✓ | ✗ | ✗ |
| Invite/remove/promote/demote Admins | ✓ | ✗ | ✗ |
| Bulk export customer data | ✓ | ✗ | ✗ |
| Billing, delete shop, transfer ownership | ✓ | ✗ | ✗ |

Exactly one Owner per shop. Nobody grants a role above their own. The Owner can't be removed or demoted; ownership only changes by an Owner-started transfer with password re-entry (old Owner becomes Admin).

## Design rules
- Dark navy nav and auth/landing pages; the app's main view is light grey (`.surface-light`, decision 21). Tokens live in `src/styles.css` (hex source values in comments, oklch values); every pair used must be listed in `src/lib/design-tokens.ts`.
- Brand: background `#101025`, accent cyan `#1AFFF4`. Cyan **only on dark surfaces** (in the light main view use navy, and teal `#00756F` for "Ready"); no other status uses the Ready color. PDFs and print: black/grey, no cyan.
- Fonts: IBM Plex Sans (400/500/600) for UI, 16 px base, never below 14 px. Courier Prime (400/700) only as an accent: logo, ticket numbers, labels, status tags, figures. Never for body text or buttons. −7% letter spacing only for the logo and big display text.
- Status colors are always paired with a label and an icon. WCAG AA for every pair (`docs/contrast.md`). Touch targets ≥ 44×44 px, visible cyan focus rings, full keyboard support, respect `prefers-reduced-motion`.
- shadcn/ui restyled with tokens; flat surfaces, subtle borders, no gradients or heavy shadows in the app. Film grain only on the marketing site.
- Logo: `public/brand/mend-wordmark.png`. Never stretch or recolor it, and keep clear space of at least the period's height around it. Photos: `public/images/`.
