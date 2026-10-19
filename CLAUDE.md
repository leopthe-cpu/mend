# Mend — rules for AI assistants

Multi-tenant job tracking and customer notifications for independent repair shops (Canada and US).
**Full spec: `docs/spec.md`.** Re-read the relevant section before working on an area. Decisions: `docs/decisions.md`; what's verified: `docs/verification.md`.

Priorities, in order: **security, correctness, a clean editorial UI.**

## Working rules

- Never invent APIs, library methods, Supabase features, CLI flags or SDK syntax. Check current official docs. If you can't verify something, say so and propose an alternative.
- Work in phases (spec §9 + addendum). At the end of each phase: stop, summarize, list what's unverified or decided on Oz's behalf, wait for a go-ahead.
- Ask before deviating from the spec. Don't fill gaps with assumptions; ask one clear question.
- Record every decision made on Oz's behalf in `docs/decisions.md` (date, decision, reason, alternatives).
- Small, descriptive commits. `git pull` before starting; push when a step is done. Never force-push or rewrite pushed history.
- **Environments (`docs/environments.md`):** work on `feature/*` branches from `develop`; PR into `develop` deploys **staging** (Railway staging + Supabase `mend-staging`); PR `develop` → `main` deploys **production** and needs Oz's approval. Never push to `main` or `develop` directly, and never point AI tools at the production database.
- **Outside-change guard:** if a pull brings changes from someone else to `supabase/`, RLS, RPC calls, auth or secrets handling, stop and show Oz the diff.
- Before pushing: `bun run lint`, `bunx tsc --noEmit`, `bun run test`, `bun run build`, and `supabase test db` when the database changed.

## Stack

TanStack Start (React 19, TS strict, Vite, Tailwind v4, shadcn/ui), built by Nitro as a Node server and hosted on **Railway** (`npm start`, decisions 61–62). Started from a Lovable template; Lovable is no longer used. Supabase project `mend` (ca-central-1) owned by Oz. Package manager: bun.

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

| Action                                                   | Owner | Admin | Staff               |
| -------------------------------------------------------- | ----- | ----- | ------------------- |
| Tickets: create/edit, move status, photos, notes         | ✓     | ✓     | ✓                   |
| Customers: create/edit, view contact info                | ✓     | ✓     | ✓                   |
| Send customer notifications                              | ✓     | ✓     | ✓                   |
| Build estimates from catalog items                       | ✓     | ✓     | ✓                   |
| Record payments                                          | ✓     | ✓     | ✓                   |
| One-off custom line items                                | ✓     | ✓     | ✗                   |
| Override catalog price on a ticket                       | ✓     | ✓     | ✗                   |
| Apply/edit/remove line-item discounts                    | ✓     | ✓     | ✗ (read-only)       |
| Edit/delete payments, delete tickets                     | ✓     | ✓     | ✗                   |
| Reveal device passcodes (audited)                        | ✓     | ✓     | assigned staff only |
| Shop settings, statuses, custom fields, templates, taxes | ✓     | ✓     | ✗                   |
| Invite and remove Staff                                  | ✓     | ✓     | ✗                   |
| View audit log                                           | ✓     | ✓     | ✗                   |
| Catalog items and catalog discounts                      | ✓     | ✗     | ✗                   |
| Invite/remove/promote/demote Admins                      | ✓     | ✗     | ✗                   |
| Bulk export customer data                                | ✓     | ✗     | ✗                   |
| Billing, delete shop, transfer ownership                 | ✓     | ✗     | ✗                   |

Exactly one Owner per shop. Nobody grants a role above their own. The Owner can't be removed or demoted; ownership only changes by an Owner-started transfer with password re-entry (old Owner becomes Admin).

## Design rules

- Apple-style look (decision 91, Oz approved the mockup on 18 Oct 2026): light grey canvas `#F5F5F7`, white cards, near-black text `#1D1D1F`, secondary text `#6E6E73`, one blue `#0066CC` for buttons, links and focus; near-black `#1D1D1F` for dark cards and sections. Tokens live in `src/styles.css` (hex source values in comments, oklch values); every pair used must be listed in `src/lib/design-tokens.ts`.
- Fonts: the device's own UI font (`-apple-system`, San Francisco on Apple devices; Segoe UI on Windows), 16 px base, never below 14 px. Ticket numbers and money use tabular figures (`.font-mono`).
- Shapes: pill buttons (`rounded-full`; primary filled blue, secondary outlined blue), cards and panels `rounded-[1.75rem]` white on the grey canvas without borders, inputs `rounded-xl`. Flat: no gradients or heavy shadows in the app (the action banners' wash is the one exception, decision 81).
- Status colors are always paired with a label and an icon. WCAG AA for every pair (`docs/contrast.md`). Touch targets ≥ 44×44 px, visible focus rings, full keyboard support, respect `prefers-reduced-motion`.
- Logo: `public/brand/mend-wordmark.png`. Never stretch or recolor it, and keep clear space of at least the period's height around it. Photos: `public/images/`.
