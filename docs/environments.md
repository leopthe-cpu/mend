# Environments: dev → staging → production

Decision 63. Changes never go straight to production: they are built on a
feature branch, tried on staging, and reach production only through a pull
request that Oz approves.

```
feature/* ──PR──▶ develop ──PR (Oz approves)──▶ main
 (work here)       STAGING                       PRODUCTION
                   Railway env "staging"         Railway env "production"
                   Supabase "mend-staging"       Supabase "mend"
```

| | Dev | Staging (pre-prod) | Production |
|---|---|---|---|
| Git branch | `feature/…` (one per change) | `develop` | `main` |
| Website | local (`bun run dev`) | Railway environment **staging** | Railway environment **production** |
| Database | local Supabase in Docker | Supabase project **mend-staging** (free) | Supabase project **mend** |
| Data | throwaway test data | test data only, **never real customers** | real shops |
| Texts / email | Mailpit (local) | off, or Twilio/Resend test credentials | live |
| Who changes it | anyone, freely | merge a PR into `develop` (tests must pass) | merge a PR into `main` (**Oz approves**) |
| AI agents (Claude, LibreChat) | full access | full access, including the staging database | **no direct access**; may open PRs only |

## Everyday flow

1. Create a branch from `develop`: `feature/short-name`.
2. Commit and push. CI runs lint, types, unit tests, build and all database
   tests on every push.
3. Open a pull request into `develop`. When CI is green, merge it; Railway
   deploys **staging** and Supabase applies the migrations to
   **mend-staging**.
4. Try it on the staging site.
5. Open a pull request from `develop` into `main`. Oz reviews and approves;
   merging deploys **production** (Railway) and applies migrations to **mend**.

Hotfix: branch from `main`, PR into `main` (Oz approves), then merge `main`
back into `develop` so staging doesn't fall behind.

## One-time setup (Oz)

Order matters: staging must exist before branch protection, so nothing is
blocked half-way.

### 1. Supabase: create the staging project
1. Supabase → **New project** in the same organization. Name `mend-staging`,
   region **Canada (Central)** like production, a strong database password
   (keep it in your password manager).
2. Project Settings → **Integrations** → **GitHub**: connect
   `leopthe-cpu/mend`, working directory `.`, enable **Deploy to
   production**, and set the production branch to **`develop`**.
   (Supabase calls it "production branch" from that project's point of view;
   for us it is staging.) Not verified: that two projects can link the same
   repository. If the dashboard refuses, tell Claude; migrations can then be
   applied from a GitHub Action instead.
3. Authentication → **URL Configuration**: Site URL = the staging Railway
   address (step 2), Redirect URLs = `https://<staging address>/**`.
4. Leave Edge Function secrets (Twilio/Resend) **empty** for now: staging
   then never texts or emails a real person. Messages stay queued.
5. Tell Claude when it exists: Claude sets the two Vault entries the
   message scheduler reads (as in production, decision 48) and checks the
   migrations applied.

### 2. Railway: add a staging environment
1. Open the project that holds the **mend** service → environment menu
   (top bar, next to "production") → **New environment** → name `staging`.
2. In **staging**, on the mend service:
   - Settings → **Source**: branch **`develop`**.
   - Variables: `VITE_SUPABASE_URL` = `https://<mend-staging ref>.supabase.co`
     and `VITE_SUPABASE_PUBLISHABLE_KEY` = mend-staging's publishable key
     (Project Settings → API Keys). Both are public values.
   - Settings → Networking → **Generate Domain**.
3. Production keeps branch `main` and no Supabase variables (it uses the
   built-in production defaults, decision 20).

### 3. GitHub: protect the branches
Repository → Settings → **Branches** (or Rules → Rulesets) → add a rule:

- **`main`**: require a pull request before merging, **require 1 approval**,
  require status checks to pass (the two CI jobs), block force pushes and
  deletions. Do not allow bypass.
- **`develop`**: require a pull request, require the CI status checks, block
  force pushes and deletions. No approval needed (staging is for trying
  things).

From then on, nobody (Claude and LibreChat included) can push straight to
`develop` or `main`.

## AI agents
- Each agent gets its **own** GitHub token, limited to this repository, that
  can push branches and open pull requests. Branch protection does the rest.
- The Supabase connector for agents is pinned to **mend-staging**
  (`project_ref`), never production (Supabase's own guidance: "Don't connect
  to production").
- LibreChat setup: `docs/librechat-agent.md` (to be written once staging
  exists).
