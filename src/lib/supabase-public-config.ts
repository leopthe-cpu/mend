// Public connection details for the production Supabase project `mend`
// (ca-central-1). Both values are PUBLIC BY DESIGN: every visitor's browser
// receives them, and all access is enforced by RLS in the database. They live
// here so every build works without extra setup (decision 20).
// VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY override them, e.g. for
// local development or a future staging project.
//
// NEVER put a secret/service-role key in this file or anywhere in src/.
export const SUPABASE_PUBLIC_DEFAULTS = {
  url: "https://zasagjabtifpuhayttki.supabase.co",
  publishableKey: "sb_publishable__wMmhEp3cEBZ5wxYN513AQ_y-mQ1t6X",
} as const;
