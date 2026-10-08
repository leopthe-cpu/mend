# Operating guide: how Oz runs Mend day to day

Plain steps for every routine job, so Mend can be run without help. Background
and reasons: `docs/environments.md` (the three environments) and
`docs/librechat-agent.md` (the agent setup).

## The accounts

| Tool | Account | Used for | Never |
|---|---|---|---|
| **GitHub** | `leopthe-cpu` (you, admin) | Merging pull requests, publishing to production, settings | — |
| **GitHub** | `w0rkstufff` (the agent) | Nothing by hand. Log in only to renew its token | Merge, approve, or browse as it |
| **LibreChat** | your LibreChat login | Asking the **Mend dev** agent for changes | Turning sign-up back on |
| **Claude Code** | claude.ai/code | Bigger changes, debugging, setup, checking things | — |
| **Railway** | your Railway login | Watching deploys, rollback, variables | Changing a deploy branch |
| **Supabase** | your Supabase login | Looking at data and logs, tokens | Changing tables in the dashboard |
| **OpenRouter** | your OpenRouter login | Credits for the agent | — |
| **GitHub Gist** | `leopthe-cpu` | The LibreChat settings file (`librechat.yaml`) | Putting a real password in it |

Note: Claude Code acts on GitHub **as `leopthe-cpu`**, so GitHub does not block
it the way it blocks `w0rkstufff`. It is bound by the same rules by agreement:
pull requests into `develop` only.

## The three places

| | Branch | Website | Database |
|---|---|---|---|
| Work in progress | `feature/...` | — | — |
| **Staging** (test) | `develop` | https://mend-staging.up.railway.app | Supabase `mend-staging` |
| **Production** (real) | `main` | https://mend-production-2e99.up.railway.app | Supabase `mend` |

Railway and Supabase update **by themselves** when a branch changes. You never
deploy by hand.

---

## 1. New feature or fix

1. **LibreChat** → agent **Mend dev** → new chat (⊕). Describe the change
   precisely: what, where, what it should look like. End with *"open a PR into
   develop"*.
   *(Or ask Claude Code the same thing.)*
2. Wait for the reply with a pull request link.
3. **GitHub as `leopthe-cpu`** → open the pull request.
   - Read **Files changed**. Does it only touch what you asked for?
   - Wait for the green ticks. Red? Tell the agent: *"CI failed on PR #N, read
     the logs and fix it on the same branch."*
4. All green → **Merge pull request** → **Confirm merge**. No approval needed.
5. Wait ~3 minutes. Railway rebuilds staging; Supabase applies any database
   change to `mend-staging`.
6. **Test on staging**: open the staging site and use the feature.
   Wrong? Back to step 1 with what's wrong.
7. Ready for real users? → section 2.

## 2. Publish to production

Do this when one or more tested changes are on staging.

1. **GitHub as `leopthe-cpu`** → https://github.com/leopthe-cpu/mend/compare/main...develop
2. **Create pull request** → **Create pull request**.
3. Wait for the green ticks, then reload the page.
4. Tick **"Merge without waiting for requirements to be met (bypass rules)"**
   (needed because you can't approve your own pull request).
5. **Merge pull request** → **Confirm merge**.
6. Wait ~3 minutes. Open the production site and check it works.
7. **Railway** → project `mend` → environment **production** → service `mend`
   → Deployments: the newest one should say **Success**.

## 3. Something broke in production

1. **Railway** → `mend` → **production** → service `mend` → **Deployments**.
2. On the last deployment that worked: **⋯ → Rollback**. The site goes back
   within a minute or two.
3. Then fix it the normal way (section 1), test on staging, publish (section 2).

Rollback only covers the website. If a **database** change caused it, don't
touch the dashboard: ask Claude Code for a new migration that undoes it.

## 4. Database changes

- Always through a pull request: the agent or Claude Code adds a file in
  `supabase/migrations/`. Staging gets it on merge into `develop`, production
  on publish.
- In the Supabase dashboard you may **look** (Table editor, Logs). Don't edit
  tables, policies or functions there.
- The agent can only reach `mend-staging`.

## 5. Agent problems and what they mean

| You see | Do this |
|---|---|
| `402 Insufficient Balance` | Agent's model is under the **DeepSeek** provider. Edit agent → Model → pick it under **OpenRouter** → Save. Or top up at https://openrouter.ai/settings/credits |
| `Upstream idle timeout exceeded` | Type **continue**. If it repeats, edit agent → model **V4 Flash** (OpenRouter) |
| Agent says it can't reach GitHub/Supabase | A token expired → section 6 |
| Red checks on its pull request | Tell it to read the CI logs and fix on the same branch |
| Agent asks to merge into `main` | No. That step is always yours (section 2) |

## 6. Every 90 days: renew the agent's tokens (next: ~5 January 2027)

**GitHub token**
1. Log in to GitHub as **`w0rkstufff`** (private window).
2. https://github.com/settings/tokens → **Generate new token (classic)**.
   Note `LibreChat Mend agent`, 90 days, scopes **repo** and **workflow** only.
3. Copy it. Delete the old token. Log out.

**Supabase token**
1. Supabase (your login) → account menu → **Access Tokens** → new token.
   Project **mend-staging only**; permissions as in `docs/librechat-agent.md`
   §3; 90 days.
2. Copy it. Revoke the old one.

**Put them in**
1. **Railway** → `mend` → **production** → service **LibreChat** → Variables.
2. Replace `GITHUB_MCP_TOKEN` and `SUPABASE_STAGING_MCP_TOKEN`.
3. **Deploy**. Test the agent with a small question.

Never paste a token into a chat, the repo or the gist.

## 7. Changing LibreChat's settings

1. **GitHub Gist as `leopthe-cpu`** → `librechat.yaml` → Edit → save.
2. Click **Raw**, copy the address (each save has a new address).
3. **Railway** → LibreChat service → Variables → `CONFIG_PATH` = new address.
4. **Deploy**. Check the agent still shows **github-mend** and
   **supabase-staging** under its tools.

## Never

- Merge into `main` without testing on staging first.
- Edit the database in the Supabase dashboard.
- Point the agent at the production database (`mend`).
- Give `w0rkstufff` more than **Write** on the repo.
- Turn `ALLOW_REGISTRATION` back on in LibreChat.
- Put secrets in the repo, the gist or a chat.
