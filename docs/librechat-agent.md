# LibreChat coding agent for Mend

Decision 64. A LibreChat agent (OpenRouter → DeepSeek V4.1 Flash) that can
read the code, push to feature branches, open pull requests, read CI results,
and use the **staging** database. It can never push to `develop` or `main`,
never approve or merge into production, and never reach the production
database. See `docs/environments.md` for the branch flow.

Sources checked 2026-10-07: LibreChat `mcp_servers` docs (remote
`streamable-http` servers, `headers` with `${ENV_VAR}`), GitHub's
`github-mcp-server` remote docs (`https://api.githubcopilot.com/mcp/`,
`X-MCP-Toolsets` header), Supabase MCP docs (`project_ref` scoping, PAT in the
`Authorization` header, "don't connect to production"), GitHub docs on
fine-grained tokens (not usable by repository collaborators) and rulesets
(bypass "for pull requests only").

## 1. A separate GitHub account for the agent

The agent must not act as Oz: GitHub never lets you approve your own pull
request, and Oz's owner rights could be used to merge into `main`.

1. Sign out (or use a private window) and create a GitHub account for the
   agent, with its own email. Ours is **`w0rkstufff`**. Turn on two-factor sign-in.
2. As Oz: `leopthe-cpu/mend` → Settings → **Collaborators** → Add people →
   `w0rkstufff` with the **Write** role. Accept the invite as `w0rkstufff`.
3. As `w0rkstufff`: Settings → Developer settings → **Personal access tokens →
   Tokens (classic)** → Generate new token (classic):
   - Note: `LibreChat Mend agent`; expiration: 90 days (set a reminder).
   - Scopes: **`repo`** and **`workflow`** only.
   - Fine-grained tokens don't work for collaborators, hence classic. The
     token reaches only repositories `w0rkstufff` was invited to (just `mend`).
4. Copy the token (`ghp_…`). Never paste it into a chat.

## 2. Branch protection (GitHub → `mend` → Settings → Rules → Rulesets)

Create two rulesets (**New ruleset → New branch ruleset**):

**`protect-main`**
- Enforcement: **Active**. Target branches: **Include by pattern** `main`.
- Bypass list: **Repository admin**, mode **For pull requests only**. Only Oz
  is an admin, so only Oz can merge into `main`; the bot (Write role) can't.
- Rules: **Restrict deletions**, **Block force pushes**, **Require a pull
  request before merging** with **1** required approval, **Require status
  checks to pass** → add `Lint, typecheck, unit tests, build, secret scan` and
  `Database tests (pgTAP, throwaway local Supabase)`.

**`protect-develop`**
- Enforcement: Active. Target: `develop`. Bypass list: Repository admin, for
  pull requests only.
- Rules: Restrict deletions, Block force pushes, Require a pull request (0
  approvals), Require the same two status checks.

Result: nobody pushes straight to `develop` or `main`. The bot opens PRs;
PRs into `develop` merge once CI is green (staging); PRs into `main` need
Oz's approval (production).

## 3. Supabase token (staging only)

Supabase → account menu → **Access Tokens** → Generate new token (scoped
token):
- Name `LibreChat staging agent`; expiration **90 days** (set a reminder).
- Project: **mend-staging only** (`guqmpdlervjwhclsndyn`). Never `mend`.
- Permissions: Project Settings **Read**, Logs **Read**, Advisors **Read**,
  Database **Read-write**, Migrations **Read**, Edge Functions **Read**,
  Storage **Read**; everything else **No access**.

The token itself can only reach mend-staging, and the connector URL below
pins the same project (`project_ref`). Migrations stay read-only on purpose:
schema changes go through a migration file in a PR, which the Supabase GitHub
integration applies to staging after the merge into `develop`. Scoped tokens
were in public alpha when this was set up (2026-10-07); if Supabase changes
them, re-check this section.

## 4. Railway: LibreChat variables (production environment, LibreChat service)

| Variable | Value |
|---|---|
| `GITHUB_MCP_TOKEN` | the `w0rkstufff` classic token |
| `SUPABASE_STAGING_MCP_TOKEN` | the Supabase access token |
| `ALLOW_REGISTRATION` | `false` (after your own LibreChat account exists; overrides the template's value) |

`ALLOW_REGISTRATION=false` stops strangers from creating LibreChat accounts
and using these tools.

## 5. LibreChat config: add the two connectors

The `CONFIG_PATH` file belongs to the template author, so make your own copy:
open the current `CONFIG_PATH` link, copy everything into a new **secret gist**
named `librechat.yaml`, add the block below at the very end (top level, no
indentation before `mcpServers:`), save, copy the gist's **Raw** link into
`CONFIG_PATH`, redeploy. If the file already has an `mcpServers:` section, add
only the two entries under it instead.

```yaml
mcpServers:
  github-mend:
    type: streamable-http
    url: "https://api.githubcopilot.com/mcp/"
    headers:
      Authorization: "Bearer ${GITHUB_MCP_TOKEN}"
      X-MCP-Toolsets: "repos,pull_requests,actions"
    requiresOAuth: false
  supabase-staging:
    type: streamable-http
    url: "https://mcp.supabase.com/mcp?project_ref=guqmpdlervjwhclsndyn"
    headers:
      Authorization: "Bearer ${SUPABASE_STAGING_MCP_TOKEN}"
    requiresOAuth: false
```

The gist holds no secrets: `${…}` is filled from Railway's variables.

## 6. Create the agent in LibreChat

Agents → **Create agent**:
- Name: `Mend dev`. Model: OpenRouter → `deepseek/deepseek-v4.1-flash`.
- Tools / MCP servers: add **github-mend** and **supabase-staging**.
- Instructions: paste the block below.

```text
You work on Mend (GitHub: leopthe-cpu/mend), a TanStack Start + React app on
Railway with Supabase. Read CLAUDE.md, docs/environments.md and docs/spec.md
in the repo before changing anything in an area.

Workflow, always:
1. Create a branch from `develop` named feature/<short-name>.
2. Commit small, focused changes to that branch only. Never push to `develop`
   or `main`, and never force-push.
3. Open a pull request into `develop`. Describe what changed and how you
   checked it.
4. Wait for CI (GitHub Actions) on the PR. If it fails, read the logs, fix on
   the same branch, push again. Never disable or skip tests.
5. Tell Oz when the PR is green. Oz (or you, if Oz says so) merges it into
   develop, which deploys staging: https://mend-staging.up.railway.app
6. Never open, approve or merge pull requests into `main`; that is Oz's step.

Database:
- The supabase-staging tools reach the STAGING database only. Use them to
  inspect tables, run read queries and test changes.
- Real schema changes go in a new file in supabase/migrations/ in your branch
  (never edit an existing migration); staging applies them after the merge
  into develop. Use execute_sql on staging for checks and test data only.
- Never ask for or use production credentials.

Rules: never invent APIs; check the repo's code and docs first. Say clearly
what you could not verify. No secrets in code, commits or messages.
```

## 7. Try it

Ask the agent: "Read docs/environments.md and list the open pull requests.
Then, on a new feature branch, fix a typo in README.md and open a PR into
develop." Check on GitHub that the PR is from `w0rkstufff`, that CI runs, and
that the bot cannot merge into `main`.

## Not covered yet
- Testing the staging site in a browser (LibreChat has no browser here). CI
  plus the staging site checked by Oz or by Claude Code cover this for now.
- Railway access for the agent (deploy logs). Possible later with a
  staging-only Railway token if LibreChat can reach Railway's MCP server
  (not verified).
