# Mend

Job tracking and "your item is ready" texts and emails for independent repair
shops (Canada and US).

- **Spec:** `docs/spec.md` · **Decisions:** `docs/decisions.md` · **Security:**
  `docs/security-review.md` · **Supabase settings:** `docs/supabase-setup.md`
- **Stack:** TanStack Start (React 19, TypeScript, Vite, Tailwind v4,
  shadcn/ui) on Supabase (Postgres with RLS, Auth, Storage, Edge Functions).

## Where it runs

| Part | Where | Deploys from |
|---|---|---|
| Website and app | Railway (`npm run build`, then `npm start`) | push to `main` |
| Database migrations, Edge Functions | Supabase project `mend` | push to `main` (Supabase GitHub integration) |
| Texts / email | Twilio / Resend, keys only in Supabase function secrets | n/a |

## Local development

Needs [bun](https://bun.sh), Node.js 22+ and Docker.

```sh
bun install
bunx supabase start          # local database, auth, storage, mail (Mailpit)
cp .env.example .env.local   # point VITE_SUPABASE_* at the local stack
bun run dev                  # http://localhost:8080
```

Checks before pushing: `bun run lint`, `bun run typecheck`, `bun run test`,
`bun run build`, and `bunx supabase test db` when the database changed.

A production build is a plain Node server: `bun run build && PORT=8080 npm start`.
Set `NITRO_PRESET` (e.g. `cloudflare-module`) only to build for another host.
