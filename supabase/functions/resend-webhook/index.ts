// Resend delivery webhooks (no Supabase JWT; every request must carry a valid
// Standard Webhooks signature made with RESEND_WEBHOOK_SECRET).
// Header names: the resend-node SDK passes id/timestamp/signature to the
// Standard Webhooks verifier as webhook-id/-timestamp/-signature; the exact
// names Resend sends could not be read from its docs here (docs/verification.md
// T4), so both the "webhook-*" and the "svix-*" spellings are accepted. The
// signature check is identical either way.
import { adminClient, json } from "../_shared/admin.ts";
import { verifyStandardWebhook } from "../_shared/signatures.ts";

const STATUS: Record<string, "sent" | "delivered" | "failed"> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.bounced": "failed",
  "email.failed": "failed",
  "email.complained": "failed",
  "email.suppressed": "failed",
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const body = await req.text();
  const h = (name: string) => req.headers.get(`webhook-${name}`) ?? req.headers.get(`svix-${name}`);
  const ok = await verifyStandardWebhook(
    Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "",
    h("id"),
    h("timestamp"),
    h("signature"),
    body,
  );
  if (!ok) return json({ error: "invalid signature" }, 403);

  let event: { type?: string; data?: { email_id?: string; bounce?: { message?: string } } };
  try {
    event = JSON.parse(body);
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const status = event.type ? STATUS[event.type] : undefined;
  const emailId = event.data?.email_id;
  if (!status || !emailId) return json({ ignored: true });

  const db = adminClient();
  const error =
    event.type === "email.bounced"
      ? `bounced: ${event.data?.bounce?.message ?? "address rejected"}`
      : event.type === "email.complained"
        ? "the customer marked this as spam"
        : event.type === "email.suppressed"
          ? "address is on the suppression list"
          : event.type === "email.failed"
            ? "could not be sent"
            : null;
  const r = await db.rpc("record_delivery_status", {
    p_message_id: null,
    p_provider: "resend",
    p_provider_message_id: emailId,
    p_status: status,
    p_error: error,
  });
  if (r.error) return json({ error: r.error.message }, 500);
  // A spam complaint means: stop emailing this person.
  if (event.type === "email.complained") {
    const c = await db.rpc("record_email_complaint", { p_provider_message_id: emailId });
    if (c.error) console.error("record_email_complaint", c.error.message);
  }
  return json({ ok: true });
});
