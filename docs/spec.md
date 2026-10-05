# Mend — Claude Code build prompt (MVP)

Oct 5, 2026 · @Oz

> Saved verbatim from the build prompt (tables re-formatted as Markdown, content unchanged).
> The **Addendum** at the end overrides the prompt where they conflict.
> Re-read the relevant section before working on an area.

## 1. Your role and working rules

You are building the MVP of Mend, a multi-tenant SaaS for independent repair shops, in a repo that is connected to a Lovable project and synced through GitHub. Security, correctness and a clean, editorial UI are the priorities, in that order.

Working rules:

- Read this whole prompt before writing code. Then inspect the repo. If it is empty or a fresh Lovable scaffold, build on Lovable's default stack (section 3). If it differs from what this prompt assumes, stop and tell me before restructuring anything.
- Never invent APIs. Do not guess function names, library methods, Supabase features, CLI flags or provider SDK syntax. Check the current official docs first. If you cannot verify something, say so and propose an alternative.
- Work in the phases in section 9. At the end of each phase, stop, summarize what was built, list anything you could not verify or decided on my behalf, and wait for my go-ahead.
- Ask before deviating. If a requirement here conflicts with how a tool works, or you think something is a bad idea, explain the tradeoff and ask. Do not silently change scope.
- Do not fill gaps with assumptions. When a requirement is ambiguous, ask one clear question rather than guessing.
- Write a CLAUDE.md at the repo root in Phase 1. It should capture the security rules (section 4), the permissions matrix (section 5), the design tokens (section 8) and the working rules above, so every future session follows them.
- Database changes only as SQL migration files in supabase/migrations/, never as ad-hoc changes in the dashboard.
- Commit in small, descriptive steps. I sometimes edit in the Lovable editor; I will not do that while you are working, but always pull before starting and push when a step is done.
- Assets. I will upload the Mend logo and the hero photography. Ask me where they landed; keep them under public/brand/ and public/images/.

## 2. Product overview and MVP scope

Mend is lightweight job tracking and customer notification software for independent repair shops. It replaces paper tickets and overly complex repair POS systems with a simple board of repair jobs, estimates built from a price catalog, and one-tap "your item is ready" texts and emails.

Target shops, one product for all: electronics and phone repair (highest value, first), ski and snowboard shops, and tailors and dry cleaners. The product adapts per shop through vertical templates (default statuses, fields and a starter catalog), not separate products.

Users: usually one owner operating alone, sometimes a small team, rarely more than a handful of people. Ages range from boomers running tailor shops to millennials in phone repair shops. The UI must be obvious without training: large touch targets, plain words, a tablet-friendly layout for use at the counter.

Markets at launch: Canada and the United States. Currency is CAD or USD per shop.

Core job to be done: receive an item, record the customer and what needs doing, give an estimate, track the work, tell the customer when it is ready ("Hi Maria, your winter coat is ready for pickup at Tailor and Cleaners"), record payment, close the ticket.

MVP includes:

- Shop signup, user accounts, roles (Owner, Admin, Staff) and invite links
- Customers
- Tickets (repair jobs) with a kanban board and a list view
- Vertical templates and per-shop custom statuses and fields
- Intake condition photos
- Catalog of services and parts (Owner-managed)
- Estimates built from catalog line items, with line-item discounts and Admin-only overrides
- Estimate and invoice PDFs
- Recording payments (no payment processing)
- SMS and email notifications with templates, send confirmation and a message log
- Printable claim tags with a QR code
- Audit log
- A marketing landing page with signup

Not in the MVP is listed in section 10. Build the data model so those features can be added without rework.

## 3. Tech stack and architecture

Use Lovable's default stack so the project stays editable in Lovable. As far as I know that is React, Vite, TypeScript, Tailwind CSS and shadcn/ui on the frontend, with Supabase (Postgres, Auth, Storage, Edge Functions) as the backend, possibly provisioned as Lovable Cloud. Confirm this against the repo and current Lovable docs before starting.

Architecture principles:

- **The browser is untrusted.** The frontend only ever holds the Supabase anon (publishable) key. Every rule that matters (tenancy, roles, prices, discounts) is enforced in the database or in server-side code, never only in the UI.
- **Row Level Security (RLS) is the tenancy boundary.** Every tenant table carries shop_id and has RLS enabled with deny-by-default policies.
- **Sensitive writes go through database functions (RPCs).** Creating and editing estimate line items, applying discounts or price overrides, recording or editing payments, changing roles, accepting invites and transferring ownership are done only through SECURITY DEFINER Postgres functions that check the caller's role and validate inputs. Direct table inserts and updates from the client are blocked for those tables. Verify the current Supabase guidance for writing these safely (search path, grants, execute permissions).
- **Third-party secrets live only in Edge Functions.** SMS and email provider keys, the service-role key and encryption keys are never shipped to the client or committed to the repo.
- **One Supabase region.** Prefer a Canadian region if Supabase offers one for this project; confirm availability and tell me before provisioning.
- **Environments.** Plan for a staging and a production Supabase project. For the MVP, at minimum keep secrets and config environment-driven so staging can be added without code changes.

Suggested app structure:

- `/` marketing landing page (public)
- `/signup`, `/login`, `/invite/:token`, `/reset-password` (public)
- `/app/...` authenticated platform with a persistent left navigation: Board, Tickets, Customers, Catalog, Messages, Settings (Settings holds Shop, Team, Statuses and fields, Message templates, Taxes, Audit log)
- `/t/:token` reserved for future customer status pages (do not build yet, but do not use this path for anything else)

Providers (verify current APIs before integrating):

- **SMS:** Twilio, with one shared, verified Mend toll-free number to start. Confirm that it can deliver to both Canadian and US mobiles and what verification it needs. Design the code so a shop-specific number or another provider can be added later.
- **Email:** Resend or Postmark (pick one and tell me why), sending from an authenticated Mend domain (SPF, DKIM, DMARC), with reply-to set to the shop's own email address.
- **PDFs:** generate estimate and invoice PDFs server-side or client-side with a well-maintained library; tell me which and why.

## 4. Security requirements

Security is a default business practice, not an add-on. Shops hold their customers' personal data, and a leak is a liability for them and for us. No system is unbreakable, so build defense in depth: one mistake must not expose everything. The most common real failures in Supabase-backed apps are missing or loose RLS policies and secrets exposed to the browser, so treat those as the top risks.

### Tenant isolation

- RLS enabled on every table in the public schema, with no exceptions. Deny by default; add explicit policies per operation (select, insert, update, delete).
- Policies check membership through a memberships table (user, shop, role) via a helper function, e.g. `is_member(shop_id)` and `has_role(shop_id, min_role)`. Verify the recommended pattern for performant RLS helper functions in current Supabase docs.
- No table is readable by the anon role except what a public page strictly needs (none in the MVP).
- Automated tests prove that a user in shop A cannot read, insert, update or delete any row of shop B, and that each role can do exactly what the permissions matrix allows and nothing more. Use Supabase's database testing approach (pgTAP, if still recommended; verify) and run the tests in CI.

### Authentication and sessions

- Email and password via Supabase Auth, with email verification required before a shop can send customer messages.
- Enforce a strong password policy (minimum length 12 is my suggestion; tell me what Supabase supports) and enable leaked-password protection if available.
- Optional TOTP multi-factor authentication for Owners and Admins, using Supabase's MFA support. Ownership transfer and bulk export require re-entering the password (and MFA when enabled).
- Removing a user from a shop takes effect immediately: their membership is deleted and their access ends on the next request. Revoke their sessions if Supabase supports it; tell me how.
- Rate limit login, signup, password reset, invite creation and message sending.

### Customer personal data

- Customer phone numbers and emails are field-level encrypted at rest, in addition to the platform's disk-level encryption. Store a keyed hash (blind index) next to each encrypted value so staff can still search by exact phone number or email. Normalize before hashing (E.164 for phones, lowercase trimmed for emails).
- Encryption and decryption happen server-side only, with keys held outside the database rows (Supabase Vault or Edge Function secrets). Supabase's column-encryption tooling has changed recently (I believe pgsodium column encryption was deprecated while Vault remains), so check current guidance and propose the approach before implementing it.
- Customer names stay plaintext so name search works; tell me if you see a better option.

### Device passcodes (electronics shops)

- Optional field on a ticket. Encrypted like contact data, never shown on the board, list, PDFs or messages.
- Visible only to Owner, Admin and the staff member assigned to the ticket, behind an explicit "Reveal" action that is written to the audit log.
- Deleted automatically when a ticket moves to the final "Picked up" status.

### Invites and links

- Invite tokens: cryptographically random, single-use, expire after 72 hours, bound to an email address and a role. Store only a hash of the token.
- Public identifiers in URLs are random (UUIDs or random tokens), never sequential ticket numbers.

### Storage (intake photos, logos)

- Private buckets with storage policies scoped by shop_id in the object path. Serve photos through short-lived signed URLs.
- Validate file type and size on upload (images only, a sensible maximum such as 10 MB; tell me what you choose).

### Audit log

- Append-only table recording who did what and when: role changes, invites, member removals, catalog price changes, discounts and overrides, payment records and edits, ticket deletions, passcode reveals, exports and settings changes. Store old and new values where relevant.
- No user can update or delete audit rows. Owner and Admin can read them.

### Other defaults

- No secrets in the repo; add .env.example with placeholder names only.
- Security headers on the hosted app where the platform allows (CSP, HSTS, frame-ancestors).
- Input validation on every form and every RPC (e.g. with zod on the client and checks inside the functions).
- Per-shop data export (Owner only) and a documented way to delete a shop's data.
- Point-in-time backups: tell me whether the current Supabase plan includes them.
- Before the end of each phase, run Supabase's security and performance advisors (if available) and fix or report every warning.

**Privacy and legal (flag, don't decide):** PIPEDA in Canada and state laws such as California's CCPA in the US apply. CASL likely exempts transactional "your item is ready" messages, but that needs legal review. Build in opt-out handling, a privacy policy page and terms page placeholders, and tell me anything that looks legally risky.

## 5. Tenancy, signup, roles and invites

Each shop is a tenant. A user belongs to a shop through a membership with exactly one role. In the MVP a user belongs to one shop, but model memberships so one user could belong to several shops later.

### Signup flow

1. A visitor signs up from the website: shop name, their name, email, password.
2. Then a short onboarding: pick a vertical (Electronics and phone repair, Ski and snowboard, Tailoring and cleaning, Other), country (Canada or US), currency (from country, editable), time zone, address, phone, business hours, tax rates, logo (optional).
3. One server-side function creates the shop, the Owner membership and the vertical's default statuses, custom fields, message templates and starter catalog, all in one transaction. The client never writes its own membership or role.

### Invite flow

1. An Owner or Admin creates an invite for an email address and a role (Admins can only invite Staff).
2. Mend emails a link with a single-use token (section 4). The inviter can also copy the link.
3. The invitee opens the link, sees the shop name and role, and creates an account (or logs in if the email already has one).
4. A server-side function verifies the token, the email match and the expiry, creates the membership and marks the invite used.
5. Owner and Admin can see pending invites and revoke them.

**Roles:** Owner, Admin, Staff. Owner has every Admin permission. Exactly one Owner per shop.

Role rules:

- Nobody can grant a role higher than their own. Admins invite and remove Staff only.
- The Owner cannot be removed or demoted by anyone. The only way to change the Owner is an ownership transfer started by the Owner, with password re-entry; the old Owner becomes Admin.
- Enforce all of this in the database functions, not only in the UI.

### Permissions matrix (enforced in RLS and RPCs; the UI hides what a role cannot do)

| Action | Owner | Admin | Staff |
|---|---|---|---|
| Create and edit tickets, move status, add photos and notes | Yes | Yes | Yes |
| Create and edit customers, view contact info | Yes | Yes | Yes |
| Send customer notifications | Yes | Yes | Yes |
| Build estimates from catalog items | Yes | Yes | Yes |
| Record payments | Yes | Yes | Yes |
| Add one-off custom line items | Yes | Yes | No |
| Override a catalog price on a ticket | Yes | Yes | No |
| Apply, edit or remove line-item discounts | Yes | Yes | No |
| Edit or delete recorded payments, delete tickets | Yes | Yes | No |
| Reveal device passcodes | Yes | Yes | Assigned staff only |
| Shop settings, statuses, custom fields, message templates, taxes | Yes | Yes | No |
| Invite and remove Staff | Yes | Yes | No |
| View audit log | Yes | Yes | No |
| Create, edit, archive catalog items and catalog discounts | Yes | No | No |
| Invite, remove, promote or demote Admins | Yes | No | No |
| Bulk export customer data | Yes | No | No |
| Billing, delete shop, transfer ownership | Yes | No | No |

Staff see catalog discounts already applied on a line, but the discount control is read-only for them.

## 6. Data model

A starting schema, not a final one. Propose improvements before building, but keep the principles. Every tenant table has id (UUID), shop_id, created_at and updated_at, and RLS enabled.

### Conventions

- Money is stored as integer cents with the shop's currency; never floats.
- Quantities are numeric with two decimals (1.5 hours of labor must work).
- Timestamps are timestamptz; date-only fields (promised date, discount end date) are interpreted in the shop's time zone.
- Phone numbers are normalized to E.164 before encryption and hashing.
- Prefer archiving (archived_at) over deleting for anything referenced by history.

| Table | Purpose | Key fields |
|---|---|---|
| shops | The tenant | name, vertical, country, currency, time_zone, address, phone, email, business_hours, logo_path, next_ticket_number, next_invoice_number, unclaimed_reminder_days, quiet_hours |
| profiles | Per-user profile | user_id (auth), full_name |
| memberships | User in a shop | shop_id, user_id, role (owner, admin, staff); unique (shop_id, user_id); at most one owner per shop |
| invites | Pending invites | shop_id, email, role, token_hash, invited_by, expires_at, used_at, revoked_at |
| customers | Shop's customers | name, phone_encrypted, phone_hash, email_encrypted, email_hash, preferred_channel, sms_opted_out, email_opted_out, notes |
| statuses | Board columns, per shop | name, position, category (open, waiting, ready, closed), color token, notify_by_default, is_final |
| custom_field_definitions | Per-shop extra ticket fields | label, type (text, number, date, select), options, required, position |
| tickets | A repair job | ticket_number (per-shop sequence), customer_id, item_name, item_description, issue_description, status_id, assigned_to, promised_date, custom_fields (jsonb, validated against definitions), passcode_encrypted, internal_notes, customer_notes, terms_accepted_at, picked_up_at, created_by |
| ticket_photos | Intake condition photos | ticket_id, storage_path, caption, uploaded_by |
| ticket_events | Ticket timeline | ticket_id, type (status change, note, message, payment, estimate), actor, data |
| tax_rates | Named rates per shop | name (e.g. "HST"), rate (numeric, e.g. 13.000), active |
| catalog_items | Services and parts | name, category, type (part, labor, service), unit (each, hour), price_cents, tax_rate_ids, sku, discount_type (percent, fixed), discount_value, discount_starts_on, discount_ends_on, archived_at |
| catalog_item_costs | Internal cost, Owner-only | catalog_item_id, cost_cents (separate table so RLS can restrict it to the Owner) |
| estimates | Versioned estimate per ticket | ticket_id, version, status (draft, sent, approved, declined, superseded), approved_at, approval_method |
| estimate_line_items | Lines on an estimate | estimate_id, position, catalog_item_id (null for custom), is_custom, name_snapshot, unit_snapshot, catalog_unit_price_cents, unit_price_cents, quantity, discount_type, discount_value, discount_source (catalog, manual), discount_reason, tax snapshot, computed line totals |
| invoices | Issued invoice | ticket_id, invoice_number (per-shop sequence), estimate_id, issued_at, totals snapshot |
| payments | Recorded payments | ticket_id, kind (deposit, payment, refund), method (cash, card, e_transfer, other), amount_cents, recorded_by, recorded_at, note |
| message_templates | Per status and channel | status_id, channel (sms, email), subject, body |
| messages | Sent message log | ticket_id, customer_id, channel, rendered body, provider_message_id, status (queued, sent, delivered, failed), error, sent_by |
| audit_log | Append-only audit trail | actor_id, action, entity, entity_id, old_values, new_values |

### Notes

- Ticket and invoice numbers increment per shop inside a server-side function, safe under concurrent requests (no gaps from failed transactions is nice to have; correctness and no duplicates is required). Display ticket numbers as #1042.
- Line totals are computed server-side by the RPC and stored, so PDFs and history never recompute from changed catalog data.

## 7. Feature specs

### 7.1 Vertical templates

Chosen at onboarding; everything they seed is editable afterwards in Settings.

| Vertical | Default statuses (in order) | Default custom fields | Starter catalog examples |
|---|---|---|---|
| Electronics and phone repair | Received, Diagnosing, Awaiting approval, Awaiting parts, In repair, Ready, Picked up | Device model, Serial or IMEI (plus the built-in passcode field) | Screen replacement, Battery replacement, Screen protector, Diagnostic, Labor (hour) |
| Ski and snowboard | Received, In service, Ready, Picked up | Equipment type, Length, Boot sole length, Binding settings | Base wax, Full tune, Edge sharpening, Binding mount, Labor (hour) |
| Tailoring and cleaning | Received, Fitting, In progress, Ready, Picked up | Garment type, Measurements, Fitting date | Hem pants, Take in waist, Zipper replacement, Dry clean, Labor (hour) |
| Other | Received, In progress, Ready, Picked up | None | Labor (hour) |

Starter catalog prices are blank or zero; the Owner fills them in. Binding settings are record-only and show a short note that the shop is responsible for safety settings. Propose better defaults if you know the industries better.

### 7.2 New ticket (intake)

The most frequent action; it must take under 60 seconds and be reachable from every screen (a primary "New ticket" button in the top bar and a keyboard shortcut).

1. Find the customer by phone, name or email, or create one inline (name, phone and/or email, preferred channel).
2. Item name ("iPhone 13", "Winter coat") and issue description.
3. Promised date (optional), assigned staff (optional), vertical custom fields, device passcode (electronics, optional).
4. Intake condition photos (optional, from camera or file).
5. Customer accepts the shop's terms (checkbox; the shop's terms text is set in Settings).
6. Save; then offer to print the claim tag.

### 7.3 Board and list

- Board: kanban columns from the shop's statuses. Cards show ticket number (Courier Prime), customer name, item name, promised date, an overdue badge, assignee initials and a photo thumbnail if present.
- Drag and drop between columns, with a keyboard and tap alternative (a status menu on the card) so it works without precise dragging.
- Overdue means the promised date has passed and the ticket is not in a ready or closed category status.
- Unclaimed: tickets in a ready status longer than the shop's unclaimed_reminder_days get a badge and a one-click "Send reminder" action.
- Closed tickets leave the board after a short period (suggest 7 days) and remain in the list.
- List view: sortable, filterable table of all tickets (status, assignee, overdue, date range), the preferred view for some users. Remember each user's last choice.
- Global search (top bar and Ctrl/Cmd+K): ticket number, customer name, exact phone number or email (via the blind index).

### 7.4 Ticket detail

One page with: customer and item, status control, custom fields, photos, estimate, payments and balance, messages, internal notes, customer-visible notes, and a timeline of every event. Passcode appears only behind "Reveal" for permitted roles (section 4).

### 7.5 Customers

List and detail pages with contact info, opt-out status, and all their tickets. Owner-only CSV export of customers (audited).

### 7.6 Catalog (Owner only)

- The Owner creates, edits and archives catalog items (section 6 fields). Items used on any ticket can only be archived, not deleted; unused items can be deleted.
- Each item can carry one catalog discount: percent or fixed amount, with an optional start date and an optional end date. Both dates are inclusive and use the shop's time zone.
- Expired discounts disappear from the active catalog view automatically; their history stays in the audit log.
- Every price or discount change is audited with old and new values.
- Admin and Staff can browse the catalog when building estimates but cannot change it.

### 7.7 Estimates and line items

- An estimate is built by picking catalog items with quantities (e.g. 1 screen, 1 battery, 2 hours of labor, 1 screen protector). The total updates live.
- When an item is added, the line copies the item's name, unit, price, tax rates and any discount active on that date. Later catalog changes never alter existing lines. A line added on Nov 29 during a sale ending Nov 30 keeps its discount even if pickup is in December.
- Owner and Admin only: add a one-off custom line (name, quantity, unit price, tax), flagged as custom and audited; override the unit price of a catalog line (the catalog price snapshot is kept so "was $180, sold at $150" is visible), audited.
- If an approved estimate changes, create a new version and keep the previous one visible, so the approval history stays honest. Record how approval was given (in person, phone, text reply).
- All line writes go through RPCs that check the role and compute totals server-side (section 3).

### 7.8 Line-item discounts

- A discount icon sits next to every line item. Clicking it opens a small inline editor: percent or fixed amount, the value, and an optional reason.
- One discount per line, maximum. If the line already has a catalog discount, the icon edits that discount (change it or remove it); it never adds a second one on top.
- No whole-order discounts in the MVP.
- Only Owner and Admin can apply, edit or remove a discount; for Staff the icon shows the discount read-only.
- Calculation order per line: line subtotal = quantity × unit price (after any override); discount applies to the line subtotal; a percent discount is 0 to 100; a fixed discount is an amount off the line total and cannot exceed the line subtotal; round to the cent per line; tax is calculated on the discounted line total. Taxes are summed per tax rate on the estimate.
- Display, everywhere (estimate, invoice, PDFs): the original price struck through, the discount (as percent or amount), and the final price, plus a "Total savings" line near the total.
- Every discount change is audited (who, old value, new value, reason).

### 7.9 Invoices and payments

- An invoice is issued from the approved estimate, with a per-shop invoice number, the shop's logo, address and tax registration number (e.g. GST/HST number; add this field to shop settings), line items with discounts as above, taxes, total, payments and balance due.
- Estimate and invoice PDFs, in the Mend visual style but led by the shop's own name and logo.
- Payments are recorded only, never processed: deposit, payment or refund; method (cash, card, e-transfer, other); amount; date; who recorded it. No card data is ever stored.
- Any role can record a payment; only Owner and Admin can edit or delete one. All changes audited.
- Moving a ticket to the final "Picked up" status with a balance due asks for confirmation.

### 7.10 Customer notifications

- Each status can have an SMS and an email template. Variables: {customer_name}, {item_name}, {shop_name}, {ticket_number}, {pickup_hours}. Default "Ready" template: "Hi {customer_name}, your {item_name} is ready for pickup at {shop_name}. {pickup_hours}"
- Confirm before sending, always, in the MVP. When a ticket moves into a status that notifies, show a dialog: "Notify Maria by SMS?" with the rendered message preview (editable for this send), channel choice, and Send or Skip. Nothing is sent automatically without that confirmation. This protects shops from accidental drags.
- Show an SMS character and segment counter.
- Respect opt-outs: inbound STOP (via the provider's webhook) sets the customer's SMS opt-out; opted-out channels are disabled with an explanation.
- Quiet hours (per shop, default 9 pm to 8 am in the shop's time zone): messages confirmed during quiet hours are queued and sent at the next allowed time, and the user is told.
- Every message is logged with delivery status from provider webhooks; failures show on the ticket.
- Emails come from the Mend sending domain with the shop name as the sender name and reply-to set to the shop's email.
- Abuse protection: rate limits per shop and a configurable monthly SMS cap per shop; email verification required before sending.
- Provider webhooks must verify signatures (check each provider's current docs).

### 7.11 Claim tags

Printable from a ticket: a customer stub (shop name, ticket number, item, promised date, shop phone) and an item tag (ticket number, customer name, item). The QR code encodes the ticket's internal app URL, which requires login, so it exposes nothing publicly. Use print-specific CSS; support a normal letter-size page and a small label size.

### 7.12 Settings

Shop profile (name, logo, address, phone, email, business hours, time zone, currency, tax registration number, terms text), Team (members, roles, invites), Statuses and custom fields, Message templates, Taxes, Notifications (quiet hours, unclaimed reminder days), Security (MFA), Audit log, Data export (Owner).

### 7.13 Marketing landing page

Editorial, cinematic, built around real street photography of shops (the images I upload). Sections: hero with photo and the headline "Keep your customers in the loop.", how it works in three steps (log the job, fix it, one tap to tell the customer), who it is for (phone repair, ski shops, tailors, each with a photo), key features, a short security section, and a signup call to action ("Get started"). No pricing yet. Include privacy policy and terms page placeholders.

## 8. Design system

The brand is editorial, urban and cinematic: real photography of real shops, cool blue night and winter tones, film grain, and a single electric cyan accent. The product carries the same feel through a dark navy interface, typewriter-style details and restraint, not decoration. Build everything from design tokens (CSS variables mapped into Tailwind and shadcn/ui) so a light mode can be added later without rework.

### 8.1 Logo

- The uploaded logo file is the source of truth. Use it as provided (SVG preferred; if I upload a PNG, ask whether I can supply an SVG).
- Construction, for reference or recreation: the lowercase wordmark "mend" followed by a period, set in Courier Prime Bold, letter spacing −7% (letter-spacing: -0.07em), line height auto, white (or off-white) on the dark background. Two details are in the accent cyan #1AFFF4: a small rounded rectangle replacing the top-left serif of the "m", and the period after the "d", also drawn as a small rounded rectangle.
- If you recreate the logo in code, match the uploaded file exactly and show me a side-by-side before using it.
- Minimum clear space around the logo: at least the height of the period on every side. Never stretch it, recolor the wordmark cyan, or place it on light backgrounds without an approved variant.

### 8.2 Typography (Google Fonts)

| Use | Font | Weight | Size | Letter spacing |
|---|---|---|---|---|
| Logo and large display moments | Courier Prime | Bold (700) | 100 px in the hero mock; scale proportionally | −7% |
| Hero tagline and page headings | IBM Plex Sans | SemiBold (600) | 60 px in the hero mock; app page titles around 28 to 32 px | 0% |
| Section headings, card titles | IBM Plex Sans | SemiBold (600) or Medium (500) | 18 to 24 px | 0% |
| Body and UI text | IBM Plex Sans | Regular (400) | 16 px base, never below 14 px | 0% |
| Ticket numbers, labels above headlines, status tags, receipt and PDF figures | Courier Prime | Regular (400) or Bold (700) | 13 to 16 px | 0% |

- Load Courier Prime 400 and 700, and IBM Plex Sans 400, 500 and 600. Provide fallback stacks (ui-monospace, monospace and system-ui, sans-serif).
- The −7% spacing is for the logo and big display text only; all UI text uses 0%.
- Courier Prime is an accent: never use it for body paragraphs, buttons or long text.
- Align prices in tables with tabular figures if IBM Plex Sans supports font-variant-numeric: tabular-nums (verify); ticket numbers are already aligned because Courier Prime is monospaced.

### 8.3 Colors

Brand colors are fixed: background #101025 and accent #1AFFF4. The other values are starting suggestions; tune them by eye and verify WCAG AA contrast (4.5:1 for text, 3:1 for large text and UI components) for every text and background pair.

| Token | Value | Use |
|---|---|---|
| --bg | #101025 | App and page background, left navigation |
| --surface-1 | #181838 (suggested) | Cards, board columns, panels |
| --surface-2 | #20204A (suggested) | Raised elements, inputs, hover states |
| --border | #2C2C5A (suggested) | Hairline borders and dividers |
| --text | #F2F2F7 (suggested) | Primary text: off-white, not pure white |
| --text-muted | #A6A6C8 (suggested) | Secondary text, hints |
| --accent | #1AFFF4 | Primary buttons, active nav item, focus rings, links, the Ready status, key highlights |
| --accent-foreground | #101025 | Text and icons on cyan buttons |

Status colors (tuned for the dark background; always paired with the status name and an icon, never color alone):

| Status category | Color (suggested) |
|---|---|
| Received | #94A3B8 slate |
| In progress | #60A5FA blue |
| Waiting (approval, parts) | #FBBF24 amber |
| Ready | #1AFFF4 brand cyan |
| Overdue (badge) | #F87171 red |
| Picked up / closed | #64748B grey |

System feedback uses separate tokens: success #4ADE80, warning #FBBF24, danger #F87171 (suggested). Because cyan means "Ready" on the board, do not use cyan for any other status.

Hard rule: cyan is only ever used on dark surfaces. Cyan text on white or light backgrounds is unreadable. PDFs and printed claim tags are printed on white, so they use the shop's name and logo in black and grey and the Mend wordmark small in the footer, with no cyan text.

### 8.4 Layout and components

- Platform layout: persistent left navigation on desktop (logo at top; Board, Tickets, Customers, Catalog, Messages, Settings; the user and shop menu at the bottom), collapsible to icons on tablets and a drawer on phones. A top bar with global search and the primary "New ticket" button. The selected nav item shows the main view.
- Hide nav items a role cannot use (e.g. Catalog editing for non-Owners shows a read-only catalog).
- Large touch targets (at least 44 by 44 px), visible cyan focus rings, full keyboard navigation, WCAG AA throughout.
- Plain-language labels and helpful empty states. Use photography in empty states and onboarding to carry the editorial feel.
- Use shadcn/ui components restyled with the tokens above; avoid default-looking components. Flat surfaces, subtle borders, generous spacing, no gradients or heavy shadows in the app.
- Motion is minimal and purposeful (drag feedback, toasts); respect prefers-reduced-motion.
- Dark mode only for the MVP; structure tokens so a light mode can be added later.

### 8.5 Marketing site look

- Full-bleed cinematic photography with a blue grade and film grain, as in the mocks I upload (a phone repair shop at night and a tailor shop on a winter morning, each with a motion-blurred red and white Toronto streetcar).
- Logo above the tagline, tagline in IBM Plex Sans SemiBold in cyan, left-aligned over the photo, with enough dark overlay behind text to keep it readable. Do not underline the tagline.
- A subtle film-grain texture overlay is allowed on the marketing site only, not in the product.
- Images optimized (modern formats, responsive sizes, lazy loading below the fold) with descriptive alt text.

## 9. Build phases and acceptance criteria

Build in five phases. Stop after each one for my review (section 1). Each phase is done only when its acceptance criteria pass and the RLS and role tests are green.

### Phase 1: Foundation

- Confirm the stack, write CLAUDE.md, set up migrations, tests and CI.
- Design tokens, fonts and logo; the app shell with left navigation and top bar (empty views are fine).
- Auth (signup, login, verification, password reset, optional MFA), signup and onboarding that creates a shop with its vertical seeds in one transaction.
- Memberships, roles, invites, member removal, ownership transfer; Settings for Shop and Team.
- RLS on every table, role helper functions, the audit log.

Accepted when: tests with two shops prove no cross-tenant access on any table; an Admin cannot invite or promote an Admin; nobody can remove or demote the Owner; expired, reused, revoked or wrong-email invite tokens are rejected; a removed member loses access immediately; Supabase advisors show no unresolved security warnings.

### Phase 2: Customers and tickets

- Field-level encryption and blind indexes for customer phone and email (propose the approach first).
- Customers list and detail; intake flow; board and list views; statuses and custom fields settings.
- Intake photos in private storage; ticket detail with timeline; global search; device passcode handling; claim tags.

Accepted when: a new ticket with a new customer can be created in under 60 seconds; search by exact phone number works through the blind index; raw phone and email values are not readable from the database tables; a passcode reveal is audited and the passcode is purged on pickup; photos from shop A cannot be read with shop B's session.

### Phase 3: Catalog, estimates, discounts, invoices, payments

- Tax rates; Owner-only catalog with catalog discounts and date ranges; Owner-only cost table.
- Estimates with versioning; line-item RPCs; custom lines, overrides and discounts by role; totals computed server-side.
- Invoices, PDFs, payments and balance due.

Accepted when the calculation tests pass, including this case (all lines taxed at a 13% HST): Screen replacement $180.00 with a 10% catalog discount = $162.00; Battery $90.00; Labor 2 hours at $60.00 with a $20.00 fixed discount = $100.00; Screen protector $25.00. Subtotal before discounts $415.00, total savings $38.00, subtotal after discounts $377.00, HST $49.01, total $426.01. Also: a Staff session calling the line-item RPC with a custom price, a custom line or a discount is rejected; changing a catalog price or discount does not change existing lines; a discount ending Nov 30 applies to a line added Nov 30 in the shop's time zone and not to one added Dec 1; every price, discount and payment change appears in the audit log.

### Phase 4: Notifications

- SMS and email providers via Edge Functions; templates and variables; the send-confirmation dialog.
- Quiet hours queue, opt-out webhook, delivery status webhooks with signature verification, the message log, per-shop rate limits and SMS cap, unclaimed reminders.

Accepted when: moving a ticket to Ready shows the confirmation with the rendered message and sends only on confirm; an opted-out customer cannot be texted; a message confirmed during quiet hours is sent at the next allowed time; provider keys are absent from the client bundle.

### Phase 5: Landing page and hardening

- Marketing landing page, privacy and terms placeholders.
- Customer data export (Owner), security headers, a final review of rate limits and policies, the full test suite, advisors clean.
- A short written security review: what is enforced where, known gaps, and what still needs legal or external review.

## 10. Out of scope, and what to verify

Not in the MVP (design the schema so these can be added without rework):

- Stock and quantity tracking for parts
- Whole-order discounts
- Payment processing (e.g. Stripe) and Mend's own subscription billing
- Customer status pages at /t/:token (reserve the route; random, unguessable tokens when built)
- Spreadsheet import and sync (Google Sheets, Excel) and migration from photos of paper tickets
- Automatic sending without confirmation, and automatic unclaimed reminders
- Light mode
- Users belonging to multiple shops (model allows it; UI does not)
- Shop-specific SMS numbers

Verify before relying on it, and tell me what you found:

- Lovable's current default stack and how GitHub sync behaves with Lovable Cloud or a connected Supabase project
- The current Supabase approach for column encryption and key storage (Vault, pgsodium status), MFA, session revocation, leaked-password protection, database testing, advisors, available regions (Canada), and backup options on our plan
- Twilio toll-free messaging coverage and verification for Canada and the US, inbound STOP handling and webhook signature verification
- The chosen email provider's domain authentication and webhook verification
- Whether IBM Plex Sans supports tabular figures

Needs a human decision or legal review (flag, never decide alone): CASL, PIPEDA, CCPA and other privacy obligations; terms and privacy policy wording; how long to retain closed tickets, photos and message logs; SMS pricing and caps per plan.

When you are ready, start with Phase 1, step 1: inspect the repo, confirm the stack, and come back with your plan for Phase 1 before writing code.

---

## ADDENDUM — these override the prompt above where they conflict

### 1. Persist the spec in the repo

In Phase 1, besides CLAUDE.md, save this full prompt to docs/spec.md and re-read the relevant section before working on an area. Keep CLAUDE.md short: working rules, database and secrets rules, permissions matrix, design rules. Point to docs/spec.md for everything else.

### 2. Add a Phase 0 before Phase 1 (no application code)

- git pull, read everything, inspect the repo.
- Report the stack actually present, and whether the backend is Lovable Cloud or a separately connected Supabase project.
- Blocking question: can you run migrations, the Supabase CLI, pgTAP in CI and the security advisors against this backend, and choose the region? If not, stop and tell me; I will decide whether to connect a separate Supabase project.
- Verify the items from section 10 that Phase 1 depends on. Write findings to docs/verification.md: finding, official source URL, date checked, confidence (verified / partly / not verified). Do not cite anything you did not open.
- Propose the Phase 1A plan (files, migrations, RPCs, tests, CI) and list blocking questions. Then stop.

### 3. Split Phase 1

- 1A Foundation: stack, CLAUDE.md, migrations, pgTAP, CI, design tokens, fonts, logo, app shell, auth (signup, login, verification, password reset), .env.example.
- 1B Tenancy: onboarding RPC with vertical seeds, memberships, roles, invites, member removal, ownership transfer, MFA, Shop and Team settings, RLS on every table, audit log.
- Phase 1's acceptance criteria apply to 1B. Additional 1A criteria: CI runs DB tests and typecheck/lint on every push; token contrast pairs checked against WCAG AA and listed.

### 4. Decision log

Record every decision you make on my behalf in docs/decisions.md (date, decision, reason, alternatives considered).

### 5. Lovable-editor guard

If a pull brings changes to anything under supabase/, RLS, RPC calls, auth or secrets handling, stop and show me the diff before continuing.

### 6. Decisions needed: propose a default, do not pick silently

- Rounding mode (my proposal: half away from zero), and whether tax is rounded per line or once per rate total. Tests must pin the choice.
- A fixed discount comes off the whole line, not per unit. Confirm this is implemented that way.
- Ticket deletion: soft delete (deleted_at) or hard delete with old values kept in the audit row.
- Onboarding: is the shop created at signup, or by a single RPC at the end of onboarding?
- Keyboard shortcut for New ticket; small label dimensions for claim tags.
- Warning/Waiting share amber and danger/Overdue share red. Keep, or propose separate values.

### 7. Schema additions

- shops: tax_registration_number, terms_text, sms_monthly_cap, quiet_hours_start, quiet_hours_end (replacing quiet_hours).
- messages: scheduled_for (for the quiet-hours queue).
- estimate_line_items: line_subtotal_cents, discount_cents, line_total_cents, tax_snapshot (jsonb: rate id, name, rate).
- audit_log: shop_id, created_at.
- Proposal (accept or reject): replace catalog_items.tax_rate_ids with a join table catalog_item_tax_rates so foreign keys hold.

### 8. Extra acceptance criteria

- Phase 1B: onboarding is atomic; a failure midway leaves no partial shop.
- Phase 4: unsigned or wrongly signed webhooks are rejected; opt-outs are enforced server-side, not only in the UI; provider keys are absent from the client bundle, checked by a grep step in CI.
- Phase 5: write the security review to docs/security-review.md.

### 9. Early flag

As soon as you know Twilio's toll-free verification requirements and timeline, tell me, even mid-phase. It may take time, and I need to start it early.

### 10. Phase 1 settings

MFA setup lives under Settings → Security and is part of Phase 1B.
