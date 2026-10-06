# Verification log

Findings Phase 1 depends on (spec §10, addendum §2). Rules:

- **Verified:** I read the official source myself, or tested it directly.
- **Partly:** an official source covers part of it, or I read it on one surface but not the one that matters.
- **Not verified:** I couldn't open an official source. Anything I saw only in search-result snippets is in this group and is **not** cited as a source.

This sandbox's network blocks `supabase.com`, `lovable.dev`, `docs.lovable.dev`, `twilio.com`, `help.twilio.com`, `resend.com` and `postmarkapp.com`. Supabase docs were read through the Supabase docs-search tool, which returns the full page text and its URL. The other vendors' pages couldn't be opened.

All checks dated **2026-10-05**.

## Repo and stack

| # | Finding | Source | Confidence |
|---|---|---|---|
| R1 | The repo is a Lovable **TanStack Start** template (`.lovable/project.json` → `tanstack_start_ts_current`). It uses React 19, TypeScript (strict), Vite 8, Tailwind CSS v4, shadcn/ui (new-york style), TanStack Router + Start, TanStack Query, zod, Vitest, ESLint and Prettier. Package manager: bun (`bun.lock`, with a 24 h minimum-release-age guard in `bunfig.toml`). It is **not** the plain Vite SPA the spec assumed. | Repo files `package.json`, `.lovable/project.json`, `vite.config.ts` | Verified |
| R2 | The production build is SSR on **Cloudflare Workers** (Nitro preset `cloudflare-module`). Server functions exist (`src/start.ts` adds CSRF middleware). A `_headers` file is generated in `.output/public/`. That may be where security headers go, but I haven't checked how Lovable hosting uses it. | `bun run build` output, `.output/nitro.json` | Verified (build); not verified (Lovable hosting) |
| R3 | Baseline is clean: install, build, `tsc --noEmit`, lint (0 errors, 6 warnings in shadcn files) and Vitest (1 test) all pass. | Ran locally | Verified |
| R4 | There is **no backend yet**: no `supabase/` folder, and Lovable reports the database as not enabled. The Lovable connector API lists "Supabase: Connect an external Supabase project" as available. | Lovable API: `get_database_status`, `list_connectors` | Verified |
| R5 | Lovable syncs the `main` branch of `leopthe-cpu/mend` (the repo was renamed from `soul-mender-spark`). `AGENTS.md` warns not to rewrite pushed history. | Repo `AGENTS.md`, `README.md` | Verified |
| R6 | How Lovable's GitHub sync behaves with an external Supabase project (for example, whether Lovable's AI writes its own migrations) | docs.lovable.dev blocked | Not verified |

## Supabase

| # | Finding | Source | Confidence |
|---|---|---|---|
| S1 | **pgTAP is still the recommended DB testing approach.** `supabase test db` runs pgTAP tests, and the docs give a GitHub Actions workflow (`supabase/setup-cli@v1` → `supabase start` → `supabase test db`). | https://supabase.com/docs/guides/local-development/testing/overview · https://supabase.com/docs/guides/local-development/cli/testing-and-linting | Verified |
| S2 | Test helpers (`basejump-supabase_test_helpers`: `tests.create_supabase_user`, `tests.authenticate_as`, `tests.rls_enabled('public')`) are installed through database.dev. Installing them makes an HTTP request from the database, which may be fragile in CI. | https://supabase.com/docs/guides/local-development/testing/pgtap-extended | Verified (docs); untested |
| S3 | **RLS helper pattern:** put `security definer` helpers in a non-exposed schema (e.g. `private`) with `set search_path = ''`. Call them wrapped as `(select private.fn())` so they run once per statement. Add `to authenticated` on every policy, index the columns policies use, and avoid joins back to the source table. Functions are executable by `PUBLIC` by default, so revoke execute from `public` and `anon`. | https://supabase.com/docs/guides/database/postgres/row-level-security · https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv · https://supabase.com/docs/guides/troubleshooting/how-can-i-revoke-execution-of-a-postgresql-function-2GYb0A | Verified |
| S4 | A table with RLS enabled and no policies returns nothing to the API. The docs' example grants `select` to `anon` explicitly, so we grant only what each role needs. The "Auto-enable RLS for new tables" event trigger exists (you ticked this at project creation). | https://supabase.com/docs/guides/database/postgres/row-level-security | Verified |
| S5 | **Password policy:** minimum length and required character classes can be set in Auth settings. **Leaked-password protection (HaveIBeenPwned) is Pro plan and above.** | https://supabase.com/docs/guides/auth/password-security | Verified. **Local:** the CLI accepts `minimum_password_length = 12` + `lower_upper_letters_digits`, and a short password is rejected with `weak_password` (tested 2026-10-06). Hosted dashboard not yet checked. |
| S6 | **MFA (TOTP)** is supported through enroll / challenge / verify / unenroll APIs. The JWT carries an `aal` claim (`aal1`/`aal2`) that RLS can check with restrictive policies. The challenge and verify endpoints are rate limited to 15 requests per minute per IP. | https://supabase.com/docs/guides/auth/auth-mfa · https://supabase.com/docs/guides/deployment/going-into-prod | Verified |
| S7 | **Sessions:** access tokens last about 1 hour by default (5 minutes minimum recommended). Session time-box, inactivity timeout and single-session are **Pro plan only**. A logged-out session can be detected by checking the JWT `session_id` against `auth.sessions`. The admin `signOut` revokes sessions using the *user's* JWT. **Consequence for "removed member loses access immediately":** because every policy reads `memberships` at query time, deleting the membership cuts off data access on the next request even though the JWT is still valid. A test will prove this. | https://supabase.com/docs/guides/auth/sessions · https://supabase.com/docs/reference/swift/auth-admin-signout | Verified (docs). Whether there's an admin API to revoke all sessions *by user id* is not verified. |
| S8 | **Auth rate limits** are configurable under Authentication → Rate Limits: OTP, signup confirmation and password reset are limited per request, with a 60 s default window. The built-in email sender has a low hourly cap, and only **custom SMTP** lets you change it; custom SMTP defaults to 30 new users/hour. The docs recommend custom SMTP for production. CAPTCHA is available on signup, sign-in and reset. | https://supabase.com/docs/guides/deployment/going-into-prod | Verified. The built-in per-hour email number didn't render in the doc text. |
| S9 | **Backups:** daily backups are for Pro, Team and Enterprise only (Pro keeps 7 days). PITR is a paid add-on on Pro or above that also needs at least Small compute. **The free plan has no platform backups**; Supabase recommends regular `supabase db dump`. Free projects may be **paused after 7 days of low activity**. | https://supabase.com/docs/guides/platform/backups · https://supabase.com/docs/guides/deployment/going-into-prod | Verified |
| S10 | **pgsodium is pending deprecation.** Supabase says not to use it in new projects, including Transparent Column Encryption. **Vault is not affected.** (Matters in Phase 2. I'll propose encrypting in Edge Functions with the key held in Vault or function secrets.) | https://supabase.com/docs/guides/database/extensions/pgsodium | Verified |
| S11 | **Regions:** `ca-central-1` (Canada Central) is listed among Supabase regions. You confirmed the `mend` project was created there. I **can't see the project**: the Supabase connector in this session only lists `storywall_v1` (us-east-2, another organization). | https://supabase.com/docs/guides/functions/regional-invocation · https://supabase.com/docs/guides/platform/regions | Partly |
| S12 | **Advisors:** the Security and Performance Advisors exist in the dashboard, and the docs describe lint rules such as `0003_auth_rls_initplan`. This session's Supabase tool has a `get_advisors` call, but it can only run once the connector can see the `mend` project. `supabase db lint` is a different tool (plpgsql_check, for function errors). | https://supabase.com/docs/guides/deployment/going-into-prod · https://supabase.com/docs/guides/observability/advisors · https://supabase.com/docs/guides/local-development/cli/testing-and-linting | Partly |
| S13 | **Running locally in this sandbox works:** with Docker started, `supabase start` (CLI 2.119.0) falls back to Docker Hub when ECR and ghcr are blocked, and `supabase test db` runs. In CI, `supabase/setup-cli@v1` defaults to CLI 2.20.3, which can't parse the current config, so the workflow pins `version: 2.119.0` (CI run 3: db job green). | Ran locally + GitHub Actions | Verified |
| S15 | In Postgres 17.6 (Supabase image), `round(numeric)` rounds **half away from zero** (`2.5→3`, `-2.5→-3`, `0.125→0.13`), while `round(float8)` rounds half to even (`2.5→2`). | Ran in `supabase/postgres:17.6.1.166` | Verified |
| S14 | The Supabase docs list **GitHub integration → "Deploy to production"** (deploys migrations from `main`) as the recommended way to deploy schema changes. | https://supabase.com/docs/guides/deployment/going-into-prod | Verified (docs). Not set up. |

## Design

| # | Finding | Source | Confidence |
|---|---|---|---|
| D1 | **IBM Plex Sans digits are tabular by default:** every digit 0–9 is 600 units wide in the 400 weight. The web files have **no `tnum` feature**, so `font-variant-numeric: tabular-nums` does nothing, and nothing is needed. Checked by reading the font tables with fontTools from `@fontsource/ibm-plex-sans@5.3.0` (latin subsets, 400 and 600). | Direct inspection of font files | Verified (Fontsource 5.3.0 **and** the TTF Google Fonts serves for the app's css2 URL, `ibmplexsans/v23`, 2026-10-06) |
| D2 | The Lovable template's `styles.css` says colors "MUST use oklch". That's a Lovable convention, not a Tailwind v4 requirement. The spec's colors are hex. | Repo `src/styles.css` | Verified (what the file says) |

## Twilio — early flag (addendum §9)

| # | Finding | Source | Confidence |
|---|---|---|---|
| T1 | Toll-free verification is required before a toll-free number can send to US and Canadian numbers. Review takes about 3–5 business days. From 17 Feb 2026, a business registration number is required for everyone except sole proprietors; for Canada that's a CBN, a provincial number or a Québec NEQ. From 15 Sep 2026, submissions need **separate Privacy Policy and Terms URLs**. | Search-result snippets from twilio.com and help.twilio.com. Pages blocked, **not opened** | **Not verified** |
| T2 | Whether one shared Mend number may send on behalf of many shops (the ISV case), what sample messages must look like, and how STOP is handled | Not opened | Not verified |

## Email provider

| # | Finding | Source | Confidence |
|---|---|---|---|
| E1 | Lovable lists **Resend** as a built-in connector. Choosing between Resend and Postmark (domain auth, webhook signing) is still open, because both vendors' docs are blocked here. | Lovable API `list_connectors` | Partly |

## To unblock the unverified rows

- Add these domains to the environment's allowed network list: `supabase.com`, `docs.lovable.dev`, `twilio.com`, `help.twilio.com`, `resend.com`, `postmarkapp.com`, `fonts.googleapis.com`, `fonts.gstatic.com`.
- Re-authorize the Supabase connector so it can see the `mend` organization.

## Phase 1A findings (2026-10-06)

| # | Finding | Source | Confidence |
|---|---|---|---|
| A1 | `ALTER DEFAULT PRIVILEGES ... IN SCHEMA x REVOKE EXECUTE ... FROM PUBLIC` does **not** remove Postgres's built-in PUBLIC execute grant on new functions. Only the global form (no `IN SCHEMA`) does. Without it, a new function in `public` stayed callable by `anon`. Fixed in the baseline migration; guarded by `002_functions_locked`. | Tested in the local Supabase DB; the guard test failed until fixed | Verified |
| A2 | The local Supabase defaults already grant `service_role` only `Dxtm` on new tables when `auto_expose_new_tables = false`. Edge Functions using the secret key will need explicit grants (Phase 2+). | `pg_default_acl` in the local DB | Verified (local) |
| A3 | supabase-js 2.117.2 defaults to the **implicit** flow (`flowType: 'implicit'`); we set `pkce`. Method names used (`signUp`, `signInWithPassword`, `resend`, `resetPasswordForEmail`, `exchangeCodeForSession`, `updateUser`, `getSession`, `onAuthStateChange`, `signOut`) and error codes all exist in the installed type definitions. | `node_modules/@supabase/auth-js/dist/module/*.d.ts` | Verified |
| A4 | With `enable_confirmations = true`, an unconfirmed user can't sign in (`email_not_confirmed`), so "verified before sending messages" holds from the first login. | Headless browser run against the local stack | Verified (local) |
| A5 | TanStack Start route option `ssr: false` exists (`SSROption = boolean \| 'data-only'`). Used for `/app` and the auth pages. | `@tanstack/router-core` type definitions | Verified |
| A6 | Lovable's dev server binds to `::` (IPv6), which this sandbox lacks; run `vite dev --host 127.0.0.1` here. Doesn't affect Lovable or production. | Ran locally | Verified |
| A7 | In this sandbox the headless browser can't load Google Fonts (certificate interception), so screenshots show fallback fonts. The real fonts **haven't been seen rendered yet**. Check in Lovable's preview. | Headless run | Not verified (visual) |
