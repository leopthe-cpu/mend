# Launch plan (after the UX round, 16 Oct 2026)

The UX round (PRs 1–8) is released. These are the remaining steps before real
shops use Mend, in order. Oz's account steps are in [oz-todo.md](oz-todo.md);
the legal research is in [legal-compliance.md](legal-compliance.md).

## L1. Twilio (texts)

**L1a. Minimum legal pages first (Claude, small PR).** Twilio rejects
toll-free verifications without live privacy policy and terms URLs (since
15 Sep 2026). They must load without login and include the opt-in
non-sharing clause (legal-compliance.md §4.1). Ship interim versions of
`/privacy` and `/terms` that:

- meet every Twilio check;
- include the SMS program terms (frequency varies, message and data rates,
  STOP/HELP, support contact);
- name the subprocessors;
- are marked "interim, under legal review".

Needs from Oz: legal name, address, contact email (legal-compliance.md §8).

**L1b. Twilio setup (Oz).** Follow `oz-todo.md`, "To turn on texts":

1. Buy the number.
2. Submit verification with the L1a URLs and a description of the in-person
   opt-in (intake tick box).
3. Set the webhook.
4. Add the 3 secrets in production only.

**L1c. Opt-out wording in texts (Claude, done 16 Oct: decision 74).** Add "Reply STOP to opt out" to
the first text (or every text) and set up the HELP reply
(legal-compliance.md §7, item 3).

## L2. Legal and privacy package (after Twilio is submitted)

All of [legal-compliance.md](legal-compliance.md) §2–§7:

1. Oz answers §8: business details, province, privacy officer, Quebec yes or
   no, retention, pricing.
2. Claude drafts:
   - D1 privacy policy;
   - D2 terms, with SMS terms and acceptable use;
   - D3 DPA;
   - D4 subprocessor list;
   - D5 internal notes, kept outside this public repo: breach register,
     retention schedule, access-request steps, Quebec PIAs if needed.
3. Oz checks and accepts the vendor DPAs: Supabase, Railway, Twilio, Resend.
4. Lawyer review of D1–D3 and the open questions (§8).
5. Product changes, one PR each (§7):
   - sign-up acceptance;
   - email footer with unsubscribe (amends decision 49);
   - shop address required;
   - intake consent wording/default;
   - retention job;
   - per-customer export;
   - Quebec gate.
6. Publish the final pages (replacing L1a); notify existing shops.

## L3. Customer emails (Resend)

Oz: secrets + webhook (`oz-todo.md`, "To turn on customer emails"). Needs the
L2 email footer first if the lawyer says unsubscribe is required.

## L4. Backups

Supabase Pro (downloadable backups, no pausing). Oz decides; check the
current price.

## L5. Custom domain

For example `app.mendshops.com` on Railway. Update the Supabase redirect URLs
and the legal page URLs submitted to Twilio. Moving them after verification
may need a resubmission (verify with Twilio).

## L6. Website wording

Decision 72: say that a "ticket created" confirmation goes out automatically
when the customer agrees. It must match the final consent wording from L2.

## L7. Real-device testing

A full day on a phone: intake, board, ticket view, texts, emails.

## Later (not blocking launch)

- US launch review: legal-compliance.md §5.
- French version, if Quebec is accepted.
- Website redesign.
