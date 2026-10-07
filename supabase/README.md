# supabase/

Database migrations, pgTAP tests and Edge Functions for Mend.

Two hosted projects deploy from this folder through Supabase's GitHub
integration (decision 63, `docs/environments.md`):

| Project | Ref | Deploys from |
|---|---|---|
| `mend-staging` | `guqmpdlervjwhclsndyn` | `develop` |
| `mend` (production) | `zasagjabtifpuhayttki` | `main` |

Changes here only as new files in `migrations/` (never edit an applied one),
tested locally with `bunx supabase test db` before pushing.
