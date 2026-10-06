// Twilio webhooks (no Supabase JWT; every request must carry a valid
// X-Twilio-Signature, checked against our public URL and the form body).
//  - Status callbacks: our own message id is in the signed URL (?m=...). We
//    don't rely on callback field names; we ask Twilio's API for the message's
//    status using the SID we stored at send time (verified fields only).
//  - Inbound texts (configure this URL as the number's incoming-message
//    webhook): STOP/START keywords set the customer's SMS opt-out.
//    NOTE: the inbound field names From and Body could not be checked against
//    Twilio's docs from this environment (docs/verification.md T5); test with
//    a real STOP before relying on it. Twilio's own opt-out handling on the
//    number still blocks sends either way.
import { adminClient, functionsBaseUrl } from "../_shared/admin.ts";
import { fetchSmsStatus } from "../_shared/providers.ts";
import { parseForm, smsKeyword, verifyTwilio } from "../_shared/signatures.ts";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
  const body = await req.text();
  const params = parseForm(body);
  // Twilio signs the public URL it called, not the internal one this runtime
  // sees, so rebuild it from the project URL plus the query string.
  const query = new URL(req.url).search;
  const publicUrl = `${functionsBaseUrl()}/twilio-webhook${query}`;
  if (!(await verifyTwilio(authToken, req.headers.get("X-Twilio-Signature"), publicUrl, params))) {
    return new Response("invalid signature", { status: 403 });
  }

  const db = adminClient();
  const messageId = new URL(req.url).searchParams.get("m");
  if (messageId) {
    if (!UUID.test(messageId)) return new Response("bad request", { status: 400 });
    const { data: sid } = await db.rpc("provider_message_id_for", { p_message_id: messageId });
    if (typeof sid === "string" && sid) {
      const s = await fetchSmsStatus({ accountSid, authToken, sender: "" }, sid);
      const status =
        s?.status === "delivered"
          ? "delivered"
          : s?.status === "failed" || s?.status === "undelivered"
            ? "failed"
            : s?.status === "sent"
              ? "sent"
              : null;
      if (status) {
        const r = await db.rpc("record_delivery_status", {
          p_message_id: messageId,
          p_provider: "twilio",
          p_provider_message_id: sid,
          p_status: status,
          p_error: s?.error ?? null,
        });
        if (r.error) console.error("record_delivery_status", r.error.message);
      }
    }
    return new Response(null, { status: 204 });
  }

  const from = typeof params["From"] === "string" ? params["From"] : null;
  const keyword = smsKeyword(typeof params["Body"] === "string" ? params["Body"] : undefined);
  if (from && keyword) {
    const r = await db.rpc("record_sms_opt_out", {
      p_phone: from,
      p_opted_out: keyword === "stop",
    });
    if (r.error) console.error("record_sms_opt_out", r.error.message);
  }
  return new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
});
