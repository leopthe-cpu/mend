# Hosted Supabase project: settings to set by hand

`supabase/config.toml` only configures the **local** stack used in development and CI. I haven't verified whether the GitHub integration also applies these auth settings to the hosted project, so set them in the dashboard for project **mend** (ca-central-1). Values must match, or the app's password rules and the server's will disagree.

## Before first real signup
| Where (dashboard) | Setting | Value |
|---|---|---|
| Authentication → Sign In / Providers → Email | Confirm email | **On** |
| same | Secure password change | **On** |
| same | Minimum password length | **12** |
| same | Password requirements | **Lowercase, uppercase letters and digits** |
| Authentication → URL Configuration | Site URL | the app's production URL (Lovable publish URL or custom domain) |
| same | Redirect URLs | `<site>/auth/confirm`, `<site>/reset-password`, plus the Lovable preview URL equivalents |
| Database → Settings | SSL enforcement | On (Supabase production checklist) |
| Integrations → GitHub | Connect `leopthe-cpu/mend`, Supabase directory `supabase`, **Deploy to production** from `main` | decision 5 |

## Before launch
- **Custom SMTP** (Authentication → Emails → SMTP). The built-in sender is heavily rate limited and meant for development only (verification S8).
- **Pro plan:** leaked-password protection, daily backups, no pausing (decision 7).
- Run the **Security** and **Performance Advisors** and fix every warning (I can do this once the connector sees the project).

## Lovable
For Lovable's preview to log in, it needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, the **publishable** key only, never the secret key. Until they're set, the auth forms show "Mend isn't connected to its database in this environment yet."
