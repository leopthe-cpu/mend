import { describe, expect, it } from "vitest";

import { unsubscribeHeaders, withEmailFooter } from "./emailFooter";

const f = {
  token: "t",
  page_url: "https://example.test/unsubscribe?t=t",
  shop_name: "Stitch & Co",
  shop_address: "1 Main St\nToronto ON",
};

describe("email footer (decision 88)", () => {
  it("names the shop, its address and the unsubscribe link", () => {
    expect(withEmailFooter("Your coat is ready.\n\n", f)).toBe(
      "Your coat is ready.\n\n--\nStitch & Co, 1 Main St, Toronto ON\nStop emails from Stitch & Co: https://example.test/unsubscribe?t=t\n",
    );
  });
  it("works without an address", () => {
    expect(withEmailFooter("Hi", { ...f, shop_address: null })).toContain(
      "--\nStitch & Co\nStop emails",
    );
  });
  it("adds one-click headers (RFC 8058)", () => {
    expect(unsubscribeHeaders("https://x.test/u?t=1")).toEqual({
      "List-Unsubscribe": "<https://x.test/u?t=1>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});
