// Sends due messages. Invoked by the app right after a message is queued and
// every minute by pg_cron (migration 20261006060100), so quiet-hours messages
// and retries go out on time. Safe to call by anyone: it only sends messages
// that members already confirmed and that are due; claim_due_messages() uses
// SKIP LOCKED, so overlapping runs never send twice.
import { adminClient, functionsBaseUrl, json } from "../_shared/admin.ts";
import { sendEmail, sendSms, type SendOutcome } from "../_shared/providers.ts";

type Due = {
  message_id: string;
  channel: "sms" | "email";
  recipient: string | null;
  subject: string | null;
  body: string;
  shop_name: string;
  reply_to: string | null;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const db = adminClient();

  const twilio = {
    accountSid: Deno.env.get("TWILIO_ACCOUNT_SID") ?? "",
    authToken: Deno.env.get("TWILIO_AUTH_TOKEN") ?? "",
    sender: Deno.env.get("TWILIO_SENDER") ?? "",
  };
  const resend = {
    apiKey: Deno.env.get("RESEND_API_KEY") ?? "",
    fromAddress: Deno.env.get("MAIL_FROM_ADDRESS") ?? "",
  };

  const { data, error } = await db.rpc("claim_due_messages", { p_limit: 20 });
  if (error) return json({ error: error.message }, 500);

  let sent = 0;
  let failed = 0;
  for (const m of (data ?? []) as Due[]) {
    let outcome: SendOutcome;
    if (!m.recipient) {
      outcome = { ok: false, error: "no recipient on file", retry: false };
    } else if (m.channel === "sms") {
      outcome =
        twilio.accountSid && twilio.authToken && twilio.sender
          ? await sendSms(
              twilio,
              m.recipient,
              m.body,
              `${functionsBaseUrl()}/twilio-webhook?m=${m.message_id}`,
            )
          : { ok: false, error: "Text messages aren't set up yet", retry: false };
    } else {
      outcome =
        resend.apiKey && resend.fromAddress
          ? await sendEmail(resend, {
              id: m.message_id,
              to: m.recipient,
              subject: m.subject ?? m.shop_name,
              text: m.body,
              fromName: m.shop_name,
              replyTo: m.reply_to,
            })
          : { ok: false, error: "Email isn't set up yet", retry: false };
    }
    const result = await db.rpc("record_send_result", {
      p_message_id: m.message_id,
      p_ok: outcome.ok,
      p_provider: m.channel === "sms" ? "twilio" : "resend",
      p_provider_message_id: outcome.ok ? outcome.providerId : null,
      p_error: outcome.ok ? null : outcome.error,
      p_retry: outcome.ok ? false : outcome.retry,
    });
    if (result.error) console.error("record_send_result", m.message_id, result.error.message);
    if (outcome.ok) sent++;
    else failed++;
  }
  return json({ sent, failed });
});
