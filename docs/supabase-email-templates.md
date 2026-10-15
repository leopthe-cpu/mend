# Supabase email template for sign-up confirmation

PR 3 adds 6‑digit OTP code verification on the sign-up page
(`verifyOtp` type `email`). The "Confirm sign up" email template must
include `{{ .Token }}` so the code appears in the email.

## Steps to update

Repeat these in **staging** (Supabase project `mend-staging`) and
**production** (Supabase project `mend`).

1. Go to **Authentication** → **Email Templates** in the Supabase
   dashboard.

2. Open the **Confirm signup** template.

3. Edit the **HTML** body. Add a line like this before the link:

   ```html
   <p style="font-size:28px;font-weight:600;letter-spacing:4px">{{ .Token }}</p>
   ```

   The `{{ .Token }}` placeholder renders the 6‑digit code.

4. The `{{ .ConfirmationURL }}` link stays as-is — it is the fallback for
   people who prefer to click the link.

5. Click **Save**.

## Why

- **OTP flow** (`src/routes/signup.tsx`): after `signUp`, the page shows
  an OTP input. The user types the code from the email; `verifyOtp` checks
  it. No extra confirmation page is needed on phones.
- **Link fallback** (`src/routes/auth/confirm.tsx`): unchanged. If someone
  opens the `{{ .ConfirmationURL }}` link, the existing `exchangeCodeForSession`
  flow still works.