// Details shown on the privacy policy and terms pages (launch-plan.md L1a,
// decision 73). One place, so both pages and the Twilio submission match.
// Address and email are pre-launch to-dos (oz-todo.md); while they are null
// the pages say so instead of showing made-up contact details.

export const LEGAL = {
  operator: "Leonardo Thé",
  tradeName: "Mend",
  province: "Ontario",
  privacyOfficer: "Leonardo Thé",
  mailingAddress: null as string | null,
  contactEmail: null as string | null,
  /** Bump when the text changes in a way users should know about. */
  version: "interim-2026-10-17",
  effectiveDate: "October 17, 2026",
} as const;

/**
 * Twilio toll-free verification rejects privacy policies that could be read
 * as sharing SMS opt-in data (errors 30520/30477) and asks for this clause.
 * Wording from Twilio's onboarding guide as found on 16 Oct 2026; re-check it
 * against the verification form when submitting (docs/legal-compliance.md §4.1).
 */
export const TWILIO_OPT_IN_CLAUSE =
  "All the above categories exclude text messaging originator opt-in data and consent; this information won't be shared with any third parties.";

/** Service providers that process personal information for Mend. */
export const SUBPROCESSORS = [
  { name: "Supabase", purpose: "Database, sign-in, file storage", location: "Canada" },
  { name: "Railway", purpose: "Runs the Mend web app", location: "United States" },
  { name: "Twilio", purpose: "Sends and receives text messages", location: "United States" },
  { name: "Resend", purpose: "Sends emails", location: "United States" },
] as const;

/**
 * How long closed tickets are kept (decision 86). Shown on the privacy policy
 * and in Settings → Your data so both say the same thing. The database job is
 * public.retention_run (migration 20261029090000).
 */
export const RETENTION_TEXT =
  "One year after a ticket is picked up or deleted, its photos, messages, notes and details are deleted, and so are customers with no other ticket. Tickets with an invoice or a payment keep the invoice, the payments and the customer's name, because Canadian tax law asks businesses to keep these records for six years; they are deleted after that. Owners and admins see a notice in the app 30 days before anything is deleted.";
