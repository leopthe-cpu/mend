import { describe, expect, it } from "vitest";

import { SECURITY_HEADERS, withSecurityHeaders } from "./security-headers";

describe("withSecurityHeaders", () => {
  it("adds every header and keeps status and body", async () => {
    const res = withSecurityHeaders(
      new Response("<p>hi</p>", { status: 404, headers: { "content-type": "text/html" } }),
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("<p>hi</p>");
    expect(res.headers.get("content-type")).toBe("text/html");
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(res.headers.get(name)).toBe(value);
    }
  });
  it("blocks framing", () => {
    const res = withSecurityHeaders(new Response(""));
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });
  it("does not override a header the app already set", () => {
    const res = withSecurityHeaders(
      new Response("", { headers: { "Referrer-Policy": "no-referrer" } }),
    );
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});
