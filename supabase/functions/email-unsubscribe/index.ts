// One-click unsubscribe (decision 88, RFC 8058): mail apps POST here from the
// List-Unsubscribe header. Safe to call by anyone: the random per-customer
// token is the only key, and it can only stop emails. People who click the
// link in the email land on /unsubscribe in the web app instead, which asks
// first (link scanners GET links; a GET here changes nothing).
import { adminClient, json } from "../_shared/admin.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "use the link in the email" }, 405);
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!UUID.test(token)) return json({ error: "unknown link" }, 404);
  const { data, error } = await adminClient().rpc("email_unsubscribe", {
    p_token: token,
    p_source: "one-click",
  });
  if (error) return json({ error: "try again later" }, 500);
  return data ? json({ ok: true }) : json({ error: "unknown link" }, 404);
});
