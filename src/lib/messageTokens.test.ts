import { describe, expect, it } from "vitest";

import { fieldLabel } from "@/lib/messages";
import { parseTemplate, toPlain, toTemplate } from "@/lib/messageTokens";

describe("message tokens (decision 146)", () => {
  const tpl = "Hi {customer_first_name}, your {item_name} is {status_name}. {unknown} stays.";

  it("turns placeholders into tokens and back", () => {
    const segs = parseTemplate(tpl, fieldLabel);
    expect(segs[1]).toEqual({ field: "customer_first_name", text: "{customer first name}" });
    expect(segs[3]).toEqual({ field: "item_name", text: "{item}" });
    expect(segs[5]).toEqual({ field: "status_name", text: "{column name}" });
    expect(toTemplate(segs)).toBe(tpl);
  });

  it("fills a ticket's values for sending", () => {
    const vals: Record<string, string> = {
      customer_first_name: "Maria",
      item_name: "iPhone 13 screen",
      status_name: "Ready",
    };
    const segs = parseTemplate(tpl, (f) => vals[f] ?? null);
    expect(toPlain(segs)).toBe("Hi Maria, your iPhone 13 screen is Ready. {unknown} stays.");
  });

  it("reads old {ticket_title} templates as the item", () => {
    expect(parseTemplate("{ticket_title}", fieldLabel)).toEqual([
      { field: "ticket_title", text: "{item}" },
    ]);
  });
});
