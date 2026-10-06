// Expected values are computed independently with Node's crypto module,
// following the official SDK implementations line by line (see signatures.ts).
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  parseForm,
  smsKeyword,
  twilioSignature,
  verifyStandardWebhook,
  verifyTwilio,
} from "./signatures";

const TOKEN = "12345";
const URL_ = "https://mycompany.com/myapp.php?foo=1&bar=2";
const PARAMS = {
  CallSid: "CA1234567890ABCDE",
  Caller: "+12349013030",
  Digits: "1234",
  From: "+12349013030",
  To: "+18005551212",
};

function nodeTwilio(token: string, url: string, params: Record<string, string>) {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
}

describe("Twilio signatures", () => {
  it("matches the SDK algorithm", async () => {
    expect(await twilioSignature(TOKEN, URL_, PARAMS)).toBe(nodeTwilio(TOKEN, URL_, PARAMS));
  });

  it("accepts a valid header, with or without the default port", async () => {
    const sig = nodeTwilio(TOKEN, URL_, PARAMS);
    expect(await verifyTwilio(TOKEN, sig, URL_, PARAMS)).toBe(true);
    const withPort = nodeTwilio(TOKEN, "https://mycompany.com:443/myapp.php?foo=1&bar=2", PARAMS);
    expect(await verifyTwilio(TOKEN, withPort, URL_, PARAMS)).toBe(true);
  });

  it("rejects missing, wrong or tampered signatures", async () => {
    const sig = nodeTwilio(TOKEN, URL_, PARAMS);
    expect(await verifyTwilio(TOKEN, null, URL_, PARAMS)).toBe(false);
    expect(await verifyTwilio("wrong", sig, URL_, PARAMS)).toBe(false);
    expect(await verifyTwilio(TOKEN, sig, URL_, { ...PARAMS, Digits: "9999" })).toBe(false);
    expect(await verifyTwilio(TOKEN, sig, URL_.replace("foo=1", "foo=2"), PARAMS)).toBe(false);
    expect(await verifyTwilio("", sig, URL_, PARAMS)).toBe(false);
  });

  it("parses repeated form keys as arrays", () => {
    expect(parseForm("a=1&b=2&a=3")).toEqual({ a: ["1", "3"], b: "2" });
  });
});

describe("Standard Webhooks (Resend)", () => {
  const raw = Buffer.from("MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw");
  const secret = "whsec_" + raw.toString("base64");
  const body = '{"type":"email.delivered","data":{"email_id":"abc"}}';
  const id = "msg_p5jXN8AQM9LWM0D4loKWxJek";
  const now = 1_790_000_000;
  const sign = (ts: number, b = body) =>
    "v1," + createHmac("sha256", raw).update(`${id}.${ts}.${b}`).digest("base64");

  it("accepts a valid signature, also among several", async () => {
    expect(await verifyStandardWebhook(secret, id, String(now), sign(now), body, now)).toBe(true);
    expect(
      await verifyStandardWebhook(secret, id, String(now), `v1,bogus ${sign(now)}`, body, now),
    ).toBe(true);
  });

  it("rejects tampered bodies, wrong secrets, old or future timestamps", async () => {
    expect(await verifyStandardWebhook(secret, id, String(now), sign(now), body + " ", now)).toBe(
      false,
    );
    expect(
      await verifyStandardWebhook(
        "whsec_" + Buffer.from("x").toString("base64"),
        id,
        String(now),
        sign(now),
        body,
        now,
      ),
    ).toBe(false);
    expect(
      await verifyStandardWebhook(secret, id, String(now - 301), sign(now - 301), body, now),
    ).toBe(false);
    expect(
      await verifyStandardWebhook(secret, id, String(now + 301), sign(now + 301), body, now),
    ).toBe(false);
    expect(await verifyStandardWebhook(secret, null, String(now), sign(now), body, now)).toBe(
      false,
    );
    expect(
      await verifyStandardWebhook(secret, id, String(now), `v2,${sign(now).slice(3)}`, body, now),
    ).toBe(false);
  });
});

describe("SMS keywords", () => {
  it.each([
    ["STOP", "stop"],
    [" stop ", "stop"],
    ["Unsubscribe.", "stop"],
    ["START", "start"],
    ["yes", "start"],
    ["Stop please", null],
    ["Thanks!", null],
    [undefined, null],
  ])("%j -> %j", (body, kind) => {
    expect(smsKeyword(body)).toBe(kind);
  });
});
