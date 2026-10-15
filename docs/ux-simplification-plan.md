# UX simplification plan (October 2026, v2)

Work plan for the coding agent. Oz has already made the product decisions below;
record each one in `docs/decisions.md` when it is implemented. v2 merges Oz's
first round of feedback from testing staging (14 Oct) with the remaining work
of v1.

**Status (15 Oct):** PR 1, 2, 3 and 6 are done and released to production
(release PR #13). Next: PR 4, 5, 6b, 7, 8. PR 6b is Oz's feedback on the
new-ticket flow (15 Oct).

## How to work

- Read `CLAUDE.md`, `docs/spec.md`, `docs/decisions.md` and
  `docs/environments.md` before starting.
- One pull request at a time, in the order below. Each from a new
  `feature/<name>` branch off `develop`, PR into `develop`.
- Before writing code for a PR: list the files and database functions you will
  change and wait for Oz's OK.
- After opening each PR: stop and report what changed, how you checked it and
  the CI result. Wait for Oz to say "next" before starting the following one.
- Keep each commit small: one file per commit when using the GitHub API, files
  end with a newline, and run Prettier formatting rules mentally (CI fails on
  formatting).
- Database changes only as new files in `supabase/migrations/` (never edit an
  existing migration). Every new or changed database function keeps the
  existing role checks and gets pgTAP tests. Update the allow-list test (002)
  when adding callable functions.
- Never invent APIs: check the code and official docs. Say what you could not
  verify.
- Use the supabase-staging tools only to inspect, never to change schema.
- Every screen touched must work at phone width (360 px) and desktop.

## Product decisions (already made)

- **Roles** (done in PR 1): owner shows as "Admin" ("Admin (owner)" on the
  Team page), admin as "Admin (co-manager)", staff as "Team member". Team
  members can create customers and tickets, add inventory items to tickets,
  record payments, send messages and reminders; they cannot manage inventory,
  discounts or message templates.
- **Internal cost, inventory units/stock, promotional messages, Google Maps
  integration (reviews, hours from Google):** future features, do not build.
- **Location:** country and time zone are taken from the user's device (time
  zone via `Intl.DateTimeFormat().resolvedOptions().timeZone`; country derived
  from it, CA or US). Show the detected values as one line with a "Change"
  link; do not ask with big controls. Country still drives currency and tax
  defaults, so it stays stored.
- **Shop hours replace "pickup hours":** one weekly schedule (each weekday:
  open/closed checkbox + open and close time). Stored in the existing
  `shops.business_hours` jsonb. Messages that showed pickup hours now show shop
  hours.
- **Catalog item types:** only "Service" and "Part". Existing `labor` items are
  converted to `service` by a migration; the UI never offers labour.
- **Mobile:** the app must be fully usable on a phone. On phones, changing a
  ticket's status happens inside the ticket (drag and drop is desktop only).

## Shared UI rules (apply everywhere)

- **Buttons:** only the main action of the app ("+ Ticket") is solid black.
  Every other add button is secondary (light): "+ Item", "+ Customer", etc.
  Labels are "+ <noun>" (no "Add item", "New ticket").
- **Dropdowns (`<select>`):** the arrow sits inside the field with right
  padding; fix once in the shared component or base styles so every dropdown
  gets it.
- **Required fields** show an asterisk (*).
- **Money input** (one shared component, used for every price, discount amount
  and payment): shows "0.00" as a placeholder only; typing fills from the cents
  side, cash-register style: typing 1 → 0.01, 0 → 0.10, 0 → 1.00, 0 → 10.00.
  Backspace removes the last digit. Stores cents.
- **Phone input** (shared component): formats as (111) 111-1111 while typing,
  digits only, same fill-as-you-type feel; stores the digits/E.164 the
  database already expects.
- **Optional fields hidden behind "+ Add …"** (e.g. "+ Add discount",
  "+ Add tax"): the field appears only after clicking, with a way to remove it.
- **List rows are clickable** (whole row opens the record), keyboard
  accessible.
- **Page padding:** content (including the board's first column) aligns with
  the page title.
- **Required fields on submit** (15 Oct): if the user submits with a required
  field empty (or an unconfirmed entry, see "Confirm small entries"), don't
  only show an error at the bottom: scroll to the **first** problem from top to
  bottom, focus it and show its message next to the field. Only one problem is
  shown at a time; after it is fixed, the next submit goes to the next one.
  Build this once as a shared helper and use it in every form.
- **Confirm small entries** (15 Oct): a value added inline under a row (e.g. a
  discount) gets a ✓ button to confirm it. Until it is confirmed it counts as
  an unfinished required field (rule above).
- **Pickers that list records** (customers, services): clicking or focusing
  the field opens the list straight away (recent / A–Z), and typing filters it.
  Don't wait for the user to type.

## PR 2: Foundations (layout, mobile, shared components)

- Responsive app shell: sidebar collapses to a menu on phones; top bar fits
  (search, "+ Ticket"); no horizontal page scroll at 360 px. Board columns
  scroll horizontally inside the board area only.
- Board: left padding so the first column aligns with the title/subtitle.
- Shared `MoneyInput` and `PhoneInput` (rules above) with unit tests; replace
  existing price/phone fields with them.
- Dropdown arrow padding fix (global).
- Button hierarchy and "+ <noun>" labels across the app.
- Remove the status dropdown from board cards (status changes by drag and drop
  on desktop, or inside the ticket).

## PR 3: Setup flow + sign-up code + invite step

- Sign-up confirmation with a 6-digit email code (Supabase `{{ .Token }}` in
  the "Confirm sign up" template + `verifyOtp` type `email`), link handling
  kept as fallback. Write the template change Oz must make in each Supabase
  project (staging, production) as exact dashboard steps; don't change
  dashboard settings yourself.
- Setup steps (`src/routes/app/setup.tsx`): Names → Trade → Location & hours →
  Taxes → Invite your team.
  - Every step has "Skip this step" placed below the step's content and above
    Back / Continue. "Do this later" (skip the whole flow) stays.
  - Trade: compact grid (2 columns on phones, 3 on desktop), not a tall list.
  - Location & hours: detected country/time zone line (see decisions),
    address, shop phone (PhoneInput), weekly shop hours editor.
  - Invite your team: skippable, uses the existing `create_invite` flow;
    the owner can invite as Team member or Admin (co-manager).
- Shop settings page uses the same weekly hours editor.

## PR 4: Catalog simplification

- Item form: name*, type (Service / Part), price* (MoneyInput), "+ Add
  discount", "+ Add tax". **Tax is managed on the item** (Oz, 15 Oct):
  "+ Add tax" lets the Admin pick one of the shop's taxes or create a new one
  right there (name + rate %), which is added to the shop's taxes and linked
  to the item. Remove a tax from the item with an ×. Remove category, SKU and "sold by" from the UI (keep
  the database columns; don't delete data).
- Migration: convert `labor` items to `service`; `save_catalog_item` rejects
  `labor` from now on (keep the enum value to avoid breaking old rows/tests,
  or explain a safe alternative).
- "+ Item" is a secondary button, labelled **"+ Catalog item"** (15 Oct).

## PR 5: Customers and tickets lists

- Customers list: whole row clickable → customer page; "+ Customer" button
  (secondary) to create a customer from this page (Oz, 15 Oct: still missing
  on staging, keep it in this PR) (name*, phone and/or email*,
  preferred contact).
- Tickets list: whole row clickable; one date-range picker (single component)
  instead of two date fields; add a "Created by" column; clicking a status or
  a creator in the table filters by it (with a visible, removable filter
  chip); remove the old filter row above the table.

## PR 6: New-ticket flow (replaces v1 PR 3)

In `src/components/tickets/NewTicketDialog.tsx`:

- **Customer:** search existing; "+ Customer" button on the right of the
  customer field (not below). Creating a customer opens a section with a
  tinted background so it stands out: name*, phone (PhoneInput) and/or email*
  (at least one), preferred contact (SMS or email; both allowed as backup).
  Show "Customer since <date>" for existing customers.
- **Description*** first; title optional, auto-filled from the first ~6 words
  of the description (editable). The database still stores a non-empty
  `item_name`.
- **Details:** remove the fixed item type / colour / size fields. Add a
  "+ Add detail" menu listing the shop's custom fields; choosing one adds that
  field to the ticket.
- **Items and price:** add lines from the catalog (searchable) or a one-off
  custom line (name + price) not saved to the catalog. Each line shows its
  price; "+ Add discount" (admins only) and "+ Add tax" per the shared rules;
  catalog discounts apply automatically. A **total** (subtotal, discounts,
  tax, total) at the bottom. Reuse `start_estimate`, `add_estimate_line`,
  `add_custom_line`; do it in one transaction if possible (propose an RPC).
- **Pick-up date:** monthly calendar; each day shows a small circle with the
  number of open tickets promised that day (light grey circle, white number;
  if that fails contrast, the closest passing grey). Read-only RPC for the
  counts per day (staff+).
- **Payment:** "Paid in full", "Pay at pick-up", or "Partial (deposit)" with an
  amount or percentage; paid/partial record a payment via the existing payment
  functions.
- Button label "Create ticket". After creating, return to the board (not the
  ticket), with a short confirmation.

## PR 6b: New-ticket refinements (Oz's feedback on staging, 15 Oct)

Follow-up to PR 6 in `src/components/tickets/NewTicketDialog.tsx`. Oz answered
the open questions on 15 Oct; they are folded in below. Build PR 4 first (the
catalog tax field below is reused here).

- **Customer field:** clicking the field opens the list of customers right
  away (most recent first; typing filters it), like the service list does. Each
  row shows the name **and** "Customer since <Mon YYYY>" (and phone or email
  if it fits). "+ Customer" stays to the right of the field.
- **Section renamed "Service"** (was "Items and price"). One row per service
  with three inline fields:
  1. **Service:** a combobox. Pick from the catalog list (it opens on click and
     filters as you type) or type a new name.
  2. **Qty:** defaults to 1.
  3. **Price:** for a catalog service it is filled from the catalog and
     **read-only**. For a newly typed service the user enters it (MoneyInput).
  - **Typing a new service is Admins only.** Team members can only pick
    existing catalog services; for them the field is a picker, not free text.
  - A newly typed service is **saved to the catalog** (as a Service item, with
    the price and any taxes entered) when the ticket is created, so it can be
    picked next time. It is saved in the same transaction as the ticket
    (extend `create_ticket_full`, which must enforce Admin for new services).
    The separate "+ Custom line" button is removed.
  - Below the rows, "+ Service" adds another row.
- **"+ Discount" and "+ Tax"** under each row, **Admins only**. Each opens a
  small inline field with a ✓ button and only counts once confirmed (shared
  rule "Confirm small entries").
  - Discount: % or $ amount, as today.
  - Tax: pick one of the shop's taxes or add a new one (name + rate %).
  - For a catalog service, the catalog's taxes and discount apply
    automatically and are shown on the row.
- **Pick-up date:** a normal date field that opens the calendar (popover) when
  clicked, not a calendar that is always shown. Keep the grey day counts inside
  the popover.
- **Payment:** one dropdown with three options:
  - **Pay at pick-up** (the default): records nothing.
  - **Paid**: records a payment for the full total. No other details are
    asked; record the method as `other`.
  - **Deposit**: shows a required amount field (MoneyInput). It must be above
    0 and at most the total when there is a total. Recorded as a deposit with
    method `other`.

  "Paid" needs a total above 0; if there is no price, hide "Paid" or explain
  why it can't be picked. Remove the old button row and the "%" option.
- **Required fields:** use the shared "Required fields on submit" rule (scroll
  to the first missing field, one at a time, top to bottom), including the
  deposit amount and any unconfirmed discount or tax.
- Record this as a new decision in `docs/decisions.md` (it changes parts of
  decision 69).

## PR 7: Ticket view

- Opening a ticket shows it **read-only**; an "Edit" button switches the
  details to editable, with Save / Cancel.
- Status can be changed inside the ticket (the way to change status on
  phones).

## PR 8: Messages: three templates + automatic "ticket created" (v1 PR 4)

- Three editable messages per shop, each for SMS and email: "Ticket created",
  "Ticket ready", "Reminder". Seed defaults for new and existing shops.
  Default "Ticket created":

  > Hi {customer_first_name}, thanks for visiting {shop_name}. Your order
  > {ticket_title} (#{ticket_number}) will be ready on {promised_date}.
  > {payment_line}

  where `payment_line` is "It's paid in full." or "Payment of {amount_due} is
  due at pick-up." Propose "Ticket ready" and "Reminder" defaults in the same
  tone (use shop hours, not pickup hours). Admins edit; staff can only send.
  Explain how this maps onto the current per-status templates and migrate
  without losing shops' edits.
- Automatic "ticket created" message: reverses decision 47. Send
  automatically ONLY if the customer agreed at intake (tick box "Send updates
  by text/email" on the new-ticket form, on by default, CASL transactional
  wording, flagged for legal review). Still goes through `queue_message`, so
  quiet hours, opt-outs and limits apply. Record the new decision.
- Twilio (SMS) will be connected soon and Resend (email) later; until then
  messages stay queued. The UI shows "queued" honestly; no code change needed
  once the secrets are set.

## Out of scope for now

PRO plan, internal cost, inventory units/stock tracking, promotional messages,
Google Maps integration (review requests, hours from Google).
