# Hosted Supabase project: settings to set by hand

`supabase/config.toml` only configures the **local** stack used in development and CI. I haven't verified whether the GitHub integration also applies these auth settings to the hosted project, so set them in the dashboard for project **mend** (ca-central-1). Values must match, or the app's password rules and the server's will disagree.

## Before first real signup
| Where (dashboard) | Setting | Value |
|---|---|---|
| Authentication → Sign In / Providers → Email | Confirm email | **On** |
| same | Secure password change | **On** |
| same | Minimum password length | **6** (Oz, decision 10b) |
| same | Password requirements | **Lowercase, uppercase letters and digits** |
| Authentication → URL Configuration (`/dashboard/project/zasagjabtifpuhayttki/auth/url-configuration`) | Site URL | `https://mend-production-2e99.up.railway.app` (Railway, decision 61) until the real domain is connected. It **defaults to `http://localhost:3000`**, which is where email links go when the app's address isn't allowed. |
| same | Redirect URLs | `https://mend-production-2e99.up.railway.app/**` (`**` = any path; Supabase docs, "Redirect URLs"). The old Lovable entries can go once Lovable is retired. Add the real domain at launch. If an email link's page isn't allowed here, Supabase sends people to the Site URL instead; the home page then forwards the link to `/auth/confirm` as a safety net. |
| Database → Settings | SSL enforcement | On (Supabase production checklist) |
| Integrations → GitHub | Connect `leopthe-cpu/mend`, Supabase directory `supabase`, **Deploy to production** from `main` | decision 5 |

## Two-step sign-in (Phase 1B)
Authentication → Multi-Factor (or "MFA"): make sure **TOTP / authenticator app** is enabled for enrolment and verification. I believe it's on by default for hosted projects but haven't verified it. If Settings → Security in the app shows an error when you click "Set up authenticator app", this is the switch.

## Customer messages (Phase 4)
Vault entries for the per-minute sender (set 2026-10-06 by Claude through the Supabase connector, decision 48; both values are public and also in `src/lib/supabase-public-config.ts`):

| Vault name | Value |
|---|---|
| `mend_project_url` | `https://zasagjabtifpuhayttki.supabase.co` |
| `mend_publishable_key` | the publishable key |

Edge Function secrets (Dashboard → Edge Functions → Secrets). **Oz sets these; never paste them in chat or code.** Until they exist, messages fail with "Text messages aren't set up yet" / "Email isn't set up yet".

| Secret | What |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio account SID (starts with AC) |
| `TWILIO_AUTH_TOKEN` | Twilio auth token (also used to check webhook signatures) |
| `TWILIO_SENDER` | The verified toll-free number in +1… format, or a Messaging Service SID (starts with MG) |
| `RESEND_API_KEY` | Resend API key with sending access |
| `MAIL_FROM_ADDRESS` | e.g. `notifications@mail.yourdomain.com` on the verified Resend domain |
| `RESEND_WEBHOOK_SECRET` | The signing secret Resend shows for the webhook (starts with `whsec_`) |

Provider webhook URLs:
- Twilio, incoming messages on the number: `https://zasagjabtifpuhayttki.supabase.co/functions/v1/twilio-webhook` (HTTP POST). Status callbacks are set per message automatically.
- Resend webhook: `https://zasagjabtifpuhayttki.supabase.co/functions/v1/resend-webhook`, events sent, delivered, bounced, complained, failed, suppressed.

The functions deploy from `main` through the GitHub integration (observed 2026-10-06: all three appeared after the push, with JWT checks off as configured).

## Before launch
- **Custom SMTP** (Authentication → Emails → SMTP). The built-in sender is heavily rate limited and meant for development only (verification S8).
- **Pro plan:** leaked-password protection, daily backups, no pausing (decision 7).
- Run the **Security** and **Performance Advisors** and fix every warning (I can do this once the connector sees the project).

## Lovable
Nothing to do. The app falls back to the production URL and publishable key in `src/lib/supabase-public-config.ts` (decision 20). To point a local copy at the local stack, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local`.
