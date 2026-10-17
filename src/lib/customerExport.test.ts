import { describe, expect, it } from "vitest";

import { customerExportText, fileSlug, type CustomerExport } from "./customerExport";

const base: CustomerExport = {
  exported_at: "2026-10-17T04:00:00Z",
  shop: { name: "Stitch & Co", address: "1 Main St", phone: "416 555 0000", email: null },
  customer: {
    name: "Ann Lee",
    phone: "+14165550141",
    email: "ann@example.com",
    preferred_channel: "sms",
    sms_opted_out: false,
    email_opted_out: true,
    notes: null,
    created_at: "2026-01-02T10:00:00Z",
  },
  tickets: [
    {
      id: "t1",
      ticket_number: 1001,
      item_name: "Wool coat",
      created_at: "2026-01-02T10:00:00Z",
      issue_description: "Replace zip",
      internal_notes: "",
      has_passcode: true,
      picked_up_at: null,
    },
  ],
  ticket_photos: [{ ticket_id: "t1" }, { ticket_id: "t1" }],
  invoices: [
    { invoice_number: 7, issued_at: "2026-01-05T10:00:00Z", total_cents: 4520, voided_at: null },
  ],
  payments: [{ paid_on: "2026-01-05", kind: "payment", amount_cents: 4520, method: "e_transfer" }],
  messages: [{ created_at: "2026-01-04T10:00:00Z", channel: "sms", body: "Your coat is ready" }],
};

describe("customerExportText", () => {
  const text = customerExportText(base);
  it("lists contact details and consent", () => {
    expect(text).toContain("Information Stitch & Co holds about Ann Lee");
    expect(text).toContain("Mobile phone: +14165550141");
    expect(text).toContain("Texts: allowed");
    expect(text).toContain("Emails: opted out");
  });
  it("lists tickets without empty fields and never shows a passcode", () => {
    expect(text).toContain("#1001 Wool coat (2026-01-02)");
    expect(text).toContain("  Work: Replace zip");
    expect(text).not.toContain("Internal notes");
    expect(text).toContain("A device passcode is stored");
    expect(text).toContain("Photos: 2");
  });
  it("lists invoices, payments and messages", () => {
    expect(text).toMatch(/#7 2026-01-05 .*45\.20/);
    expect(text).toContain("(e-transfer)");
    expect(text).toContain("2026-01-04 by text: Your coat is ready");
  });
  it("ends with how to reach the shop", () => {
    expect(text.trim().split("\n").at(-1)).toBe(
      "Questions or corrections: Stitch & Co, 1 Main St · 416 555 0000",
    );
  });
});

describe("fileSlug", () => {
  it("keeps names ASCII so browsers use them", () => {
    expect(fileSlug("Ann Lée")).toBe("ann-lee");
    expect(fileSlug("  O'Brien & Sons ")).toBe("o-brien-sons");
    expect(fileSlug("李")).toBe("customer");
  });
});
