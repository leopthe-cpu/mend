import { describe, expect, it } from "vitest";

import { missingTextContact, phoneComplete, shopAttention } from "@/lib/shop";

describe("missingTextContact (decision 131)", () => {
  it("is false only when both the address and the phone are set", () => {
    expect(missingTextContact({ address: "185 Crawford St", phone: "(416) 555-0100" })).toBe(false);
  });
  it("is true when either one is missing or blank", () => {
    expect(missingTextContact({ address: null, phone: "(416) 555-0100" })).toBe(true);
    expect(missingTextContact({ address: "185 Crawford St", phone: null })).toBe(true);
    expect(missingTextContact({ address: "   ", phone: "(416) 555-0100" })).toBe(true);
    expect(missingTextContact({ address: "185 Crawford St", phone: " " })).toBe(true);
  });
});

describe("phoneComplete", () => {
  it("needs at least 10 digits, whatever the formatting", () => {
    expect(phoneComplete("(416) 555-0100")).toBe(true);
    expect(phoneComplete("+1 416 555 0100")).toBe(true);
    expect(phoneComplete("416-555-010")).toBe(false);
    expect(phoneComplete("")).toBe(false);
  });
});

describe("shopAttention", () => {
  it("lists the contact details customers would notice are missing, in page order", () => {
    expect(shopAttention({ address: null, phone: " ", email: null })).toEqual([
      "address",
      "phone",
      "email",
    ]);
    expect(
      shopAttention({ address: "185 Crawford St", phone: "(416) 555-0100", email: null }),
    ).toEqual(["email"]);
    expect(
      shopAttention({ address: "185 Crawford St", phone: "(416) 555-0100", email: "a@b.co" }),
    ).toEqual([]);
  });
});
