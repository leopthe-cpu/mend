import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Browser-only Supabase client. Only the URL and the PUBLISHABLE key are ever
// shipped to the browser (spec §3); every rule that matters is enforced by
// RLS/RPCs in the database. Secret/service keys never appear in this repo.
//
// PKCE flow: email links come back with a one-time `?code=` that is exchanged
// on our own pages (/auth/confirm, /reset-password), instead of tokens in the
// URL fragment (the implicit flow, supabase-js's default).

let client: SupabaseClient | undefined;

export class SupabaseConfigError extends Error {}

export function getSupabase(): SupabaseClient {
  if (typeof window === "undefined") {
    throw new Error("getSupabase() is browser-only; call it from event handlers or client routes.");
  }
  if (!client) {
    const url = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
    const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined;
    if (!url || !key) {
      throw new SupabaseConfigError(
        "Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY (see .env.example).",
      );
    }
    client = createClient(url, key, {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
