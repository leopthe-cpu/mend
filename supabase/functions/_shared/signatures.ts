// Webhook signature checks, written against the providers' official SDK
// source because their docs sites are blocked from this build environment
// (docs/verification.md T2-T4):
//  - Twilio: twilio-node 6.1.2 lib/webhooks/webhooks.js getExpectedTwilioSignature
//    = base64(HMAC-SHA1(authToken, url + concat(sorted key + value))).
//    The SDK also accepts the URL with and without the default port.
//  - Resend: resend-node 6.32.0 webhooks.verify -> standardwebhooks 1.1.1
//    = "v1," + base64(HMAC-SHA256(base64decode(secret minus "whsec_"),
//      `${id}.${timestamp}.${body}`)), timestamp within 5 minutes.
// Only Web Crypto is used, so the same file runs in Deno (Edge Functions)
// and in Node (vitest).

const enc = new TextEncoder();

function toBase64(bytes: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Length-independent comparison so timing doesn't leak how much matched. */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function hmac(
  alg: "SHA-1" | "SHA-256",
  key: Uint8Array<ArrayBuffer>,
  data: string,
): Promise<string> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: alg }, false, ["sign"]);
  return toBase64(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}

export type FormParams = Record<string, string | string[]>;

/** Parse an x-www-form-urlencoded body, keeping repeated keys as arrays. */
export function parseForm(body: string): FormParams {
  const out: FormParams = {};
  for (const [k, v] of new URLSearchParams(body)) {
    const prev = out[k];
    out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}

export async function twilioSignature(
  authToken: string,
  url: string,
  params: FormParams,
): Promise<string> {
  let data = url;
  for (const key of Object.keys(params).sort()) {
    const v = params[key];
    if (Array.isArray(v)) {
      for (const one of [...new Set(v)].sort()) data += key + one;
    } else {
      data += key + v;
    }
  }
  return hmac("SHA-1", enc.encode(authToken), data);
}

function withDefaultPort(url: string): string {
  const u = new URL(url);
  if (u.port) return u.toString();
  const port = u.protocol === "https:" ? "443" : "80";
  return `${u.protocol}//${u.host}:${port}${u.pathname}${u.search}${u.hash}`;
}

function withoutPort(url: string): string {
  const u = new URL(url);
  u.port = "";
  return u.toString();
}

export async function verifyTwilio(
  authToken: string,
  header: string | null,
  url: string,
  params: FormParams,
): Promise<boolean> {
  if (!authToken || !header) return false;
  for (const candidate of [withoutPort(url), withDefaultPort(url)]) {
    if (safeEqual(header, await twilioSignature(authToken, candidate, params))) return true;
  }
  return false;
}

export const STANDARD_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export async function standardWebhookSignature(
  secret: string,
  id: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const key = fromBase64(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret);
  return `v1,${await hmac("SHA-256", key, `${id}.${timestamp}.${body}`)}`;
}

/**
 * Verify a Standard Webhooks request (Resend). `signatures` is the header
 * value: one or more space-separated "v1,<base64>" entries.
 */
export async function verifyStandardWebhook(
  secret: string,
  id: string | null,
  timestamp: string | null,
  signatures: string | null,
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!secret || !id || !timestamp || !signatures) return false;
  const ts = Number.parseInt(timestamp, 10);
  if (Number.isNaN(ts) || Math.abs(nowSeconds - ts) > STANDARD_WEBHOOK_TOLERANCE_SECONDS)
    return false;
  const expected =
    (await standardWebhookSignature(secret, id, String(ts), body)).split(",")[1] ?? "";
  for (const entry of signatures.split(" ")) {
    const [version, sig] = entry.split(",");
    if (version === "v1" && sig && safeEqual(sig, expected)) return true;
  }
  return false;
}

/** Inbound SMS keywords (carrier-standard STOP/START words). */
const STOP_WORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "OPTOUT",
  "REVOKE",
]);
const START_WORDS = new Set(["START", "UNSTOP", "YES"]);

export function smsKeyword(body: string | undefined): "stop" | "start" | null {
  const word = (body ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  return null;
}
