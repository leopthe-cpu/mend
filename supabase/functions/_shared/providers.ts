// Provider calls, matching the official SDKs (docs/verification.md T2-T4):
//  - Twilio REST: POST https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json,
//    form fields To, From | MessagingServiceSid, Body, StatusCallback; Basic auth
//    (account SID : auth token). GET .../Messages/{MessageSid}.json returns
//    status, error_code, error_message. (twilio-node 6.1.2)
//  - Resend: POST https://api.resend.com/emails, Bearer API key, JSON with
//    from, to, subject, text, reply_to; optional Idempotency-Key header;
//    response { id }. (resend-node 6.32.0)

export type SendOutcome =
  { ok: true; providerId: string } | { ok: false; error: string; retry: boolean };

const TWILIO_API = "https://api.twilio.com/2010-04-01";

export type TwilioConfig = {
  accountSid: string;
  authToken: string;
  /** A Messaging Service SID (MG...) or a sender number in E.164. */
  sender: string;
};

function twilioAuth(cfg: TwilioConfig): string {
  return "Basic " + btoa(`${cfg.accountSid}:${cfg.authToken}`);
}

/** 5xx, 429 and network errors are worth one more try; other 4xx are not. */
function retryable(status: number): boolean {
  return status >= 500 || status === 429;
}

async function errorText(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return String(j?.message ?? j?.error ?? res.statusText).slice(0, 300);
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

export async function sendSms(
  cfg: TwilioConfig,
  to: string,
  body: string,
  statusCallback: string,
): Promise<SendOutcome> {
  const form = new URLSearchParams({ To: to, Body: body, StatusCallback: statusCallback });
  form.set(cfg.sender.startsWith("MG") ? "MessagingServiceSid" : "From", cfg.sender);
  try {
    const res = await fetch(`${TWILIO_API}/Accounts/${cfg.accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: twilioAuth(cfg),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    if (!res.ok) return { ok: false, error: await errorText(res), retry: retryable(res.status) };
    const j = await res.json();
    return typeof j?.sid === "string"
      ? { ok: true, providerId: j.sid }
      : { ok: false, error: "Twilio returned no message id", retry: false };
  } catch (e) {
    return { ok: false, error: `network error: ${String(e).slice(0, 200)}`, retry: true };
  }
}

export async function fetchSmsStatus(
  cfg: TwilioConfig,
  sid: string,
): Promise<{ status: string; error: string | null } | null> {
  let j;
  try {
    const res = await fetch(
      `${TWILIO_API}/Accounts/${cfg.accountSid}/Messages/${encodeURIComponent(sid)}.json`,
      { headers: { Authorization: twilioAuth(cfg) } },
    );
    if (!res.ok) return null;
    j = await res.json();
  } catch (e) {
    // Twilio unreachable: keep the current status; a later callback updates it.
    console.error("fetchSmsStatus", String(e).slice(0, 200));
    return null;
  }
  const code = j?.error_code ? `${j.error_code}` : "";
  const msg = j?.error_message ? String(j.error_message) : "";
  return { status: String(j?.status ?? ""), error: [code, msg].filter(Boolean).join(": ") || null };
}

export type ResendConfig = { apiKey: string; fromAddress: string };

export async function sendEmail(
  cfg: ResendConfig,
  msg: {
    id: string;
    to: string;
    subject: string;
    text: string;
    fromName: string;
    replyTo: string | null;
  },
): Promise<SendOutcome> {
  // Display name is the shop; the address is Mend's authenticated domain.
  const name = msg.fromName.replace(/["<>\r\n]/g, "").slice(0, 80);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        // Our message id: a retried request can't send the email twice.
        "Idempotency-Key": msg.id,
      },
      body: JSON.stringify({
        from: `"${name}" <${cfg.fromAddress}>`,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
      }),
    });
    if (!res.ok) return { ok: false, error: await errorText(res), retry: retryable(res.status) };
    const j = await res.json();
    return typeof j?.id === "string"
      ? { ok: true, providerId: j.id }
      : { ok: false, error: "Resend returned no email id", retry: false };
  } catch (e) {
    return { ok: false, error: `network error: ${String(e).slice(0, 200)}`, retry: true };
  }
}
