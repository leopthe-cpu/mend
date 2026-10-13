# UX simplification plan (October 2026)

Work plan for the coding agent. Oz has already made the product decisions below;
record each one in `docs/decisions.md` when it is implemented.

## How to work

- Read `CLAUDE.md`, `docs/spec.md`, `docs/decisions.md` and
  `docs/environments.md` before starting.
- One pull request at a time, in the order below. Each from a new
  `feature/<name>` branch off `develop`, PR into `develop`.
- Before writing code for a PR: list the files and database functions you will
  change and wait for Oz's OK.
- After opening each PR: stop and report what changed, how you checked it and
  the CI result. Wait for Oz to say "next" before starting the following one.
- Database changes only as new files in `supabase/migrations/` (never edit an
  existing migration). Every new or changed database function keeps the
  existing role checks and gets pgTAP tests. Update the allow-list test (002)
  when adding callable functions.
- Never invent APIs: check the code and official docs. Say what you could not
  verify.
- Use the supabase-staging tools only to inspect, never to change schema.

## Product decisions

- **Roles:** keep `owner` / `admin` / `staff` in the database. In the UI, owner
  is "Admin" and staff is "Team member"; the middle admin role stays for
  co-managers.
- **Team members (staff) can:** create customers and tickets, add inventory
  items to tickets, record payments, send messages and reminders.
  **They cannot:** create, edit or delete inventory items, add or change
  discounts, edit message templates.
- **Admins (owner and admin)** can do everything, including inventory,
  discounts and templates.
- **Future PRO plan (do not build now):** inventory units / stock tracking,
  promotional messages.

## PR 1: Permissions

- Inventory (`save_catalog_item` and the catalog page): allow admin and owner,
  not only owner.
- Discounts (`set_line_discount` and any other discount entry point): admin
  and owner only. Catalog discounts still apply automatically for everyone.
- UI: hide or disable the discount controls and the inventory edit controls
  for staff, with a short explanation.
- Rename role labels in the UI: owner → "Admin", staff → "Team member";
  propose wording for the middle admin role (e.g. "Admin (co-manager)").
- pgTAP: staff blocked from catalog edits and discounts; admin allowed.

## PR 2: Sign-up with a 6-digit code + invite step

- Sign-up confirmation uses a 6-digit email code (Supabase `{{ .Token }}` in
  the "Confirm sign up" template + `verifyOtp` with type `email`) instead of a
  link. Keep the existing link handling working as a fallback. Write the
  template change Oz must make in each Supabase project (staging and
  production) as exact dashboard steps; do not change dashboard settings
  yourself.
- Add a final, skippable "Invite your team" step to the in-app setup
  (`src/routes/app/setup.tsx`), using the existing `create_invite` flow.
  Invitees join as Team member (staff).

## PR 3: New-ticket flow

In `src/components/tickets/NewTicketDialog.tsx`:

- **Customer:** pick an existing one or create one on the spot (exists, keep).
  A new customer needs a name plus phone and/or email; preferred contact (SMS
  or email) is a single choice; both contacts are allowed as a backup. Show
  "Customer since <date>" (`customers.created_at`) in the customer picker and
  on the customer page.
- **Description first.** The title (`item_name`) becomes optional in the form:
  if empty, fill it from the first ~6 words of the description (editable
  before saving). The database still stores a non-empty `item_name`.
- **Itemization at creation:** add lines from inventory (searchable dropdown)
  or a one-off custom line (name + price) that is NOT saved to inventory.
  Reuse the existing estimate functions (`start_estimate`,
  `add_estimate_line`, `add_custom_line`) so the ticket starts with a draft
  estimate; do it in one database transaction if possible (propose an RPC).
- **Discounts:** inventory item discounts show and apply automatically. The
  manual discount field is for admins only (PR 1).
- **Pick-up date:** a monthly calendar. Each day shows a small circle with the
  number of open tickets promised for that day (light grey circle, white
  number). Count = tickets with that `promised_date`, not picked up, not
  deleted. Add a read-only RPC returning counts per day for a month (staff+).
  Check colour contrast against the design tokens; if light grey with white
  text fails, propose the closest grey that passes.
- **Payment status at creation:** "Paid in full", "Pay at pick-up", or
  "Partial (deposit)" with an amount or a percentage of the total. Paid and
  partial record a payment through the existing payment functions (kind
  deposit / payment).
- Show the total (with tax and discounts) before saving.

## PR 4: Messages: three templates + automatic "ticket created"

- **Templates:** each shop gets exactly three editable messages, each for SMS
  and email: "Ticket created", "Ticket ready", "Reminder". Seed defaults for
  new and existing shops. Default "Ticket created" text:

  > Hi {customer_first_name}, thanks for visiting {shop_name}. Your order
  > {ticket_title} (#{ticket_number}) will be ready on {promised_date}.
  > {payment_line}

  where `payment_line` is "It's paid in full." or "Payment of {amount_due} is
  due at pick-up." Propose "Ticket ready" and "Reminder" defaults in the same
  tone. Admins edit; staff can only send. Explain how this maps onto the
  current per-status templates, and migrate without losing shops' edits.
- **Automatic "ticket created" message:** this reverses decision 47 (every
  message confirmed by a person). New rule: send automatically ONLY if the
  customer agreed at intake (a tick box "Send updates by text/email" on the
  new-ticket form, on by default, wording suited to CASL transactional
  messages; flag it for legal review). It must still go through
  `queue_message`, so quiet hours, opt-outs and per-shop / per-ticket limits
  apply. Record a new decision explaining the change.
- **Sending:** Twilio (SMS) will be connected soon and Resend (email) later;
  until then messages stay queued. The UI must show "queued" honestly, and no
  code change may be needed once the Twilio / Resend secrets are set (they are
  read from Edge Function secrets, which Oz sets).

## Out of scope for now

PRO plan, inventory units / stock tracking, promotional messages.
