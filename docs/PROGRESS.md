---
project: Mend
updated: 2026-10-18
summary: The MVP (phases 1–5) and the UX round (PRs 1–8) are live on www.mendshops.com, and the interim legal pages, unsubscribe, retention and customer export shipped on 17–18 Oct. Texts and customer emails are still off until Oz sets up Twilio and Resend, and the full legal package with a lawyer review comes next.
---

## Doing

## To do
- [ ] Legal package drafts: privacy policy, terms, DPA, subprocessor list @claude #legal
  D1–D4. Comes after Twilio is submitted and Oz has answered §8.
  Source: docs/launch-plan.md L2.2; docs/legal-compliance.md §2–§7
- [ ] Internal privacy notes kept outside the public repo @claude #legal
  D5: breach register, retention schedule, access-request steps.
  Source: docs/launch-plan.md L2.2
- [ ] Intake consent wording, staff script and default tick @claude #legal #app
  The default (ticked or not) depends on the lawyer's answer.
  Source: docs/legal-compliance.md §7.6; docs/launch-plan.md L2.5
- [ ] Quebec gate at sign-up @claude #legal #app
  Decision 73: no Quebec shops at launch. Whether the gate is built: status unclear.
  Source: docs/legal-compliance.md §7.11; docs/launch-plan.md L2.5
- [ ] Publish the final legal pages and notify existing shops @claude #legal
  These replace the interim L1a pages.
  Source: docs/launch-plan.md L2.6
- [ ] Website wording for the automatic "ticket created" message @claude #website
  Must match the final consent wording from L2.
  Source: docs/launch-plan.md L6; decision 72
- [ ] Real-device test day: intake, board, ticket, texts, emails @me #testing
  Source: docs/launch-plan.md L7
- [ ] Run the Security and Performance Advisors before launch @claude #security
  Status unclear: the last run on record is from Phase 1A (6 Oct).
  Source: docs/supabase-setup.md "Before launch"
- [ ] Read the security review §2 and §3 @me #security
  Private copy (decision 65): known gaps and the questions for a lawyer.
  Source: docs/oz-todo.md "Before real shops use Mend"
- [ ] Consider a longer minimum password (8+) @me #auth
  Source: docs/oz-todo.md "Before real shops use Mend"
- [ ] Two-step sign-in on Oz's Supabase and GitHub accounts @me #security
  Source: docs/oz-todo.md "Before real shops use Mend"
- [ ] Let people delete their own Mend login @claude #privacy
  Not offered in the app yet. Today it is done in Supabase → Authentication → Users.
  Source: docs/data-deletion.md "Not covered"
- [ ] US launch review @claude #legal #later
  Not blocking launch.
  Source: docs/launch-plan.md "Later"; docs/legal-compliance.md §5
- [ ] French version, if Quebec is accepted later @claude #later
  Source: docs/launch-plan.md "Later"

## Waiting
- [ ] Connect Resend as custom SMTP so sign-up emails reach everyone @me #email #setup
  Still open in oz-todo.md ("Tomorrow"). The built-in Supabase sender only reaches team members.
  Source: docs/oz-todo.md "connect Resend"
- [ ] Twilio: buy a toll-free number and submit verification @me #sms #setup
  The next launch step (L1b). The interim legal pages and contact details it needs are live. Whether it has started: status unclear. Verification takes days.
  Source: docs/launch-plan.md L1b; docs/oz-todo.md "To turn on texts" steps 1–2
- [ ] Twilio secrets and webhook in production, then a STOP test @me #sms #setup
  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SENDER in Edge Function secrets.
  Source: docs/oz-todo.md "To turn on texts" steps 3–5; docs/launch-plan.md L1b
- [ ] Customer emails: Resend secrets and webhook @me #email #setup
  RESEND_API_KEY, MAIL_FROM_ADDRESS, RESEND_WEBHOOK_SECRET. The unsubscribe footer needed first is now built (decision 88).
  Source: docs/oz-todo.md "To turn on customer emails"; docs/launch-plan.md L3
- [ ] Answer the legal questions: business registration, retention, pricing @me #legal
  Province (Ontario) and Quebec (no) are decided. Still open: registration number (if not a sole proprietor), retention periods for the lawyer, pricing or "free during beta".
  Source: docs/legal-compliance.md §8
- [ ] Find a lawyer to review the privacy policy, terms and DPA @me #legal
  Open questions: pre-ticked box, CASL 6(6) and unsubscribe, cross-border consent, Alberta/BC, whether STOP should also stop emails.
  Source: docs/launch-plan.md L2.4; docs/legal-compliance.md §8
- [ ] Check and accept vendor DPAs: Supabase, Railway, Twilio, Resend @me #legal
  Source: docs/launch-plan.md L2.3
- [ ] Decide on Supabase Pro for backups and no pausing @me #setup
  Check the current price at supabase.com/pricing.
  Source: docs/launch-plan.md L4; docs/oz-todo.md
- [ ] Approve decision 87: per-customer data export @me #decision
  Status "proposed (Claude)"; already built.
  Source: docs/decisions.md 87
- [ ] Approve decision 88: unsubscribe link in every email @me #decision
  Status "proposed (Claude)"; already built.
  Source: docs/decisions.md 88
- [ ] Confirm decision 48 (Vault values set by hand) and review the decision 44 limits @me #decision
  oz-todo still asks about the 500 texts a month, but decision 84 changed that to 100.
  Source: docs/oz-todo.md "Decide"; docs/decisions.md 44, 48, 84

## Done
- [x] Phase 1A foundation: CI, pgTAP, design tokens, app shell, auth @claude #app (2026-10-06)
  Source: git log 6 Oct; docs/decisions.md "Decided during Phase 1A"
- [x] Phase 1B: shops, roles, invites, audit log, two-step sign-in @claude #app (2026-10-06)
  Source: docs/decisions.md "Phase 1B"; commit "Phase 1B screens"
- [x] Phase 2: encrypted customers, tickets, board, timeline, photos @claude #app (2026-10-06)
  Source: docs/decisions.md "Phase 2"; commit "Phase 2 intake, board, ticket detail"
- [x] Phase 3: catalog, estimates, discounts, invoices, payments @claude #app (2026-10-06)
  Source: docs/decisions.md "Phase 3"
- [x] Phase 4: text and email sending, webhooks, opt-outs @claude #sms #email (2026-10-06)
  Built and deployed. Sending stays off until the provider secrets are set.
  Source: docs/decisions.md "Phase 4"; docs/supabase-setup.md
- [x] Phase 5: landing page, data export, shop deletion, security headers @claude #app (2026-10-06)
  Source: docs/decisions.md "Phase 5" (56–60); docs/data-deletion.md
- [x] Hosting on Railway, Lovable removed from the build @claude #infra (2026-10-06)
  Source: docs/decisions.md 61–62
- [x] Staging and production environments with protected branches @claude #infra (2026-10-07)
  Source: docs/environments.md; docs/decisions.md 63–65
- [x] LibreChat coding agent set up with its own GitHub account @me #infra (2026-10-07)
  Source: docs/librechat-agent.md; docs/decisions.md 64
- [x] UX simplification PRs 1–8, released to production @claude #ux (2026-10-16)
  Source: docs/ux-simplification-plan.md status line (release PR 21)
- [x] Interim privacy policy and terms pages @claude #legal (2026-10-16)
  Source: docs/launch-plan.md L1a; commit "Interim privacy policy and terms of service"
- [x] "Reply STOP to opt out" in a customer's first text @claude #sms (2026-10-16)
  Source: docs/launch-plan.md L1c; docs/decisions.md 74
- [x] Terms acceptance recorded at sign-up @claude #legal (2026-10-16)
  Source: docs/decisions.md 75
- [x] Shop contact page, with address and phone required @claude #legal (2026-10-16)
  Source: docs/decisions.md 76
- [x] Shop told when a customer replies STOP @claude #sms (2026-10-16)
  Source: docs/decisions.md 77
- [x] New-ticket form redesign, rounds 1–3 @claude #ux (2026-10-17)
  Source: docs/decisions.md 78, 80, 82
- [x] Shop opening days drive "Ready by" and message hours @claude #ux (2026-10-16)
  Source: docs/decisions.md 79
- [x] Ticket page header, banners and "Services & price" @claude #ux (2026-10-17)
  Source: docs/decisions.md 81, 83
- [x] Texts capped at 100 a month per shop, plain punctuation @claude #sms (2026-10-17)
  Source: docs/decisions.md 84
- [x] Device passcodes behind a feature flag, reveal cap 10 an hour @claude #security (2026-10-17)
  Source: docs/decisions.md 85
- [x] Retention: closed tickets cleared after 1 year @claude #privacy (2026-10-18)
  Decision dated 17 Oct; merged to main 18 Oct (PR 42).
  Source: docs/decisions.md 86; docs/data-deletion.md
- [x] Export one customer's data @claude #privacy (2026-10-18)
  Source: docs/decisions.md 87; release PR 48
- [x] Unsubscribe link and one-click unsubscribe in every email @claude #email #legal (2026-10-18)
  Source: docs/decisions.md 88; release PR 48
- [x] Custom domain www.mendshops.com @me #infra (2026-10-18)
  Supabase Site URL and redirect URLs updated by Oz.
  Source: docs/decisions.md 89; docs/launch-plan.md L5
- [x] Legal name, contact email and mailing address on the legal pages @me #legal (2026-10-18)
  Source: docs/oz-todo.md "Pre-launch"; docs/decisions.md 90
- [x] Launch scope: Ontario law, no Quebec, sole proprietor @me #legal (2026-10-16)
  Source: docs/decisions.md 73

## Marketing
- [x] Marketing landing page @claude #website
  Built in Phase 5 with brand-doc copy (decision 51) and shop photos.
  Source: docs/spec.md §7.13; docs/decisions.md 50–51, 55
- [ ] Update the website wording on automatic "ticket created" messages @claude #website
  Source: docs/launch-plan.md L6
- [ ] Website redesign @me #website #later
  Listed as later, not blocking launch.
  Source: docs/launch-plan.md "Later"
- [ ] Decide public pricing: Starter $19 and Workshop $39, or free in early access @me #pricing
  The site shows these prices with "Free while Mend is in early access". Pricing is still open in legal-compliance §8.
  Source: docs/decisions.md 51; docs/legal-compliance.md §8
