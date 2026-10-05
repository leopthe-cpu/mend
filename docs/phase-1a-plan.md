# Phase 1A plan — Foundation (proposal, not started)

Scope from addendum §3: stack, CLAUDE.md, migrations, pgTAP, CI, design tokens, fonts, logo, app shell, auth (signup, login, verification, password reset), `.env.example`.
**Not in 1A** (that's 1B): shops, memberships, invites, onboarding RPC, MFA, audit log, Settings pages.

Each step below is its own commit, so any one can be reverted alone.

## 1. Repo hygiene and rules
- `CLAUDE.md` (short): working rules, database and secrets rules, the permissions matrix, design rules, the Lovable-editor guard, and a pointer to `docs/spec.md`. Keep Lovable's block in `AGENTS.md`.
- `.env.example` containing only placeholder names: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. Server-only names (`SUPABASE_SECRET_KEY` etc.) are listed as comments marked "Edge Functions / CI secrets only".
- `.gitignore`: add `.env`, `.env.*` (except `.env.example`), and `supabase/.temp`, `supabase/.branches`.

## 2. Supabase project scaffold
- `supabase/config.toml` from `supabase init` (CLI v2.119.0, via `bunx`). Local auth settings mirror what we want in production: email confirmations on, `minimum_password_length = 12`, all character classes required. I'll check each key name against the CLI's generated file, not from memory.
- **Migration `…_baseline_security.sql`:**
  - `create schema private` (not exposed through the API) for future `security definer` helpers.
  - `revoke execute on all functions in schema public from public, anon`, plus default privileges so new functions are not callable by `PUBLIC` or `anon` unless granted (from verification S3).
  - Default privileges: `anon` gets **nothing** on new `public` tables; `authenticated` gets only what each migration grants explicitly.
- **Migration `…_profiles.sql`:** `public.profiles (user_id uuid pk references auth.users on delete cascade, full_name text, created_at, updated_at)`, RLS on. Policies `to authenticated`: select/update own row using `(select auth.uid()) = user_id`. No insert/delete from the client. Rows are created by a `security definer` trigger on `auth.users` insert, in schema `private`, with `search_path = ''`. Plus a shared `updated_at` trigger function.

## 3. Database tests (pgTAP)
- `supabase/tests/database/000_setup.sql`: install pgTAP and the test helpers. If installing the helpers through database.dev turns out flaky (verification S2), fall back to small helper functions of our own in a `tests` schema that only the test run creates.
- `001_rls_everywhere.sql`: **every table in `public` has RLS enabled**, and `anon` has no table privileges in `public`. This is the guard that runs on every future migration.
- `002_functions_locked.sql`: no function in `public` or `private` is executable by `anon` or `PUBLIC`.
- `003_profiles.sql`: user A can read and update only their own profile; user B sees zero rows from A; `anon` sees nothing; nobody can insert or delete through the client.
- `004_rounding.sql`: pins `round(numeric)` half-away-from-zero (decision P1).

## 4. CI — `.github/workflows/ci.yml` (on every push and pull request)
- Job **app**: `oven-sh/setup-bun` → `bun install --frozen-lockfile` → `bun run lint` → `bunx tsc --noEmit` → `bun run test` → `bun run build` → **secret-leak grep**: fail if `.output/` or `src/` contains `service_role`, `sb_secret_`, or the names `SUPABASE_SECRET_KEY` / `TWILIO_AUTH_TOKEN` / `RESEND_API_KEY`.
- Job **db**: `supabase/setup-cli@v1` → `supabase start` → `supabase test db` (the official recipe, verification S1). This runs against a throwaway local database in CI, never production.
- I'll pin action versions after checking each action's current release on GitHub.

## 5. Design tokens, fonts, logo
- `src/styles.css`: replace the template palette with the spec §8.3 tokens (`--bg`, `--surface-1/2`, `--border`, `--text`, `--text-muted`, `--accent`, `--accent-foreground`, the status colors, success/warning/danger), mapped onto shadcn's variables (`--background`, `--card`, `--primary`, `--ring` …). The `.dark`-only structure is kept so a light theme can be added later. **Hex or oklch?** See question Q4.
- Fonts: Google Fonts `<link>` in `__root.tsx` head (Courier Prime 400/700, IBM Plex Sans 400/500/600, `display=swap`) plus the fallback stacks. Tailwind theme sets `--font-sans` and `--font-mono`. I'll re-check that the Google Fonts Plex file also has fixed-width digits (D1).
- **Contrast check:** `src/lib/contrast.ts` (WCAG 2.x relative luminance) plus a Vitest test that asserts every text/background pair we use meets AA, and writes the table into `docs/contrast.md`. If a suggested color fails, I'll propose an adjusted value rather than change it silently.
- Logo: **waiting for your upload** (Q5). Until then a plain text placeholder ("mend.") in Courier Prime Bold. No recreated SVG until you've seen a side-by-side.
- Page title, description and OG tags in `__root.tsx` changed from "Lovable App" to Mend.

## 6. App shell (empty views)
- Public routes: `/` (simple placeholder; the real landing page is Phase 5), `/login`, `/signup`, `/reset-password`, `/auth/confirm` (email-verification landing), `/privacy`, `/terms` (placeholders). These two are early on purpose: Twilio needs live URLs (T1).
- `/app` layout: left nav (Board, Tickets, Customers, Catalog, Messages, Settings, plus a user menu at the bottom) that collapses to icons at tablet width and becomes a drawer on phones (shadcn `sidebar`). A top bar with a search field (Ctrl/Cmd+K opens an empty command palette) and the **New ticket** button (`N`, disabled until Phase 2). Each nav item shows an empty state.
- `/invite/$token` and `/t/$token` reserved: a stub, and `/t` returns 404 for now.
- 44 px minimum touch targets, cyan focus ring, `prefers-reduced-motion` respected.

## 7. Auth
- `@supabase/supabase-js` client in `src/lib/supabase.ts`, reading only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The browser keeps the session; **no secret keys anywhere in the app**.
- Forms use react-hook-form + zod. Signup asks for shop name, your name, email and password (12+ characters). Shop name and your name go into signup metadata **only to pre-fill onboarding** (decision P5).
- Email verification: signup shows "check your email", and `/auth/confirm` finishes it. `/app` redirects anyone not signed in to `/login` and anyone unverified to a "verify your email" screen.
- Password reset: request → email → `/reset-password` sets a new password.
- I'll look up the exact supabase-js method names in the current reference before using them.
- **Testing in 1A:** auth flows are tested in a headless browser against the local Supabase stack, with emails caught by Mailpit (verification S1/S8), if `supabase start` works in this sandbox (S13). Otherwise only CI covers the DB, and I'll say exactly what wasn't run.

## 8. Before calling 1A done
- Run lint, typecheck, tests and build locally. CI must be green on `main`.
- Supabase **advisors** (security + performance) on the real project: needs Q1. Every warning fixed or reported.
- Phase report: what was built, what's untested, and every decision added to `docs/decisions.md`.

## Blocking questions

1. **Q1 — Supabase access (blocking):** the Supabase connector in this session only sees `storywall_v1` (another organization). Please re-authorize it to include the **mend** organization. Without that I can't apply migrations, read the project URL and publishable key, or run the advisors. *Don't* paste the database password or any secret key into chat.
2. **Q2 — How migrations reach production:** (a) **Supabase's GitHub integration** with "Deploy to production" from `main` (recommended in the Supabase docs, S14; you set it up in the Supabase dashboard), or (b) a GitHub Action using an access token stored as a repo secret. **Recommend (a).**
3. **Q3 — Stack:** OK to keep the TanStack Start template (decision 2)?
4. **Q4 — Colors format:** Lovable's template says colors "MUST use oklch". I propose keeping your **hex values as the source of truth** in a comment, with the converted oklch values in the CSS so Lovable's AI stays consistent. OK?
5. **Q5 — Assets:** have you uploaded the logo (SVG preferred) and the hero photos? Where are they?
6. **Q6 — Supabase plan:** on Free you **lose** leaked-password protection, session time limits and backups, and the project can pause after 7 days of low activity (S5, S7, S9). Fine for building; **Pro before launch** is my recommendation. No action needed now. Just confirm you're OK building on Free.
7. **Q7 — Proposed defaults P1–P10** in `docs/decisions.md`: approve, or tell me which to change.
8. **Q8 — Lovable ↔ Supabase link:** for Lovable's preview to work, the project will need the Supabase URL and publishable key. Lovable has an "external Supabase" connector, but I can't read Lovable's docs from here, so I don't know whether connecting it also makes Lovable's AI write migrations. I suggest **connecting it in Lovable only when 1A reaches the auth step**, and never using Lovable's AI for database changes.
