// Service-role Supabase client for Edge Functions. Uses the new secret key
// (SUPABASE_SECRET_KEYS, JSON), falling back to the legacy service-role key
// (Supabase docs: Edge Functions > Environment variables). It is only used to
// call the service-role-only database functions from the Phase 4 migration.
import { createClient } from "npm:@supabase/supabase-js@2";

export function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    try {
      key = JSON.parse(keys)["default"] ?? key;
    } catch {
      // keep the legacy key
    }
  }
  if (!url || !key) throw new Error("Supabase URL or secret key missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Public base URL of this project's functions (what providers call back). */
export function functionsBaseUrl(): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
