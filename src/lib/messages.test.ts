import { describe, expect, it } from "vitest";

import { renderTemplate, smsSegments } from "./messages";

const vars = {
  customer_name: "Maria Rossi",
  item_name: "winter coat",
  shop_name: "Tailor and Cleaners",
  ticket_number: 1042,
  pickup_hours: "Mon-Sat 9-6",
};

describe("renderTemplate", () => {
  it("renders the spec's default Ready template", () => {
    expect(
      renderTemplate(
        "Hi {customer_name}, your {item_name} is ready for pickup at {shop_name}. {pickup_hours}",
        vars,
      ),
    ).toBe("Hi Maria, your winter coat is ready for pickup at Tailor and Cleaners. Mon-Sat 9-6");
  });

  it("handles a missing pickup time and repeated variables", () => {
    expect(
      renderTemplate("Ticket {ticket_number}: {item_name} ({item_name}). {pickup_hours}", {
        ...vars,
        pickup_hours: "",
      }),
    ).toBe("Ticket #1042: winter coat (winter coat).");
  });
});

describe("smsSegments", () => {
  it("counts plain text as GSM-7", () => {
    expect(smsSegments("a".repeat(160))).toEqual({
      encoding: "GSM-7",
      units: 160,
      segments: 1,
      perSegment: 160,
    });
    expect(smsSegments("a".repeat(161)).segments).toBe(2);
    expect(smsSegments("a".repeat(306)).segments).toBe(2);
    expect(smsSegments("a".repeat(307)).segments).toBe(3);
  });

  it("counts extension characters twice", () => {
    expect(smsSegments("€").units).toBe(2);
    expect(smsSegments("{" + "a".repeat(158)).segments).toBe(1);
    expect(smsSegments("{" + "a".repeat(159)).segments).toBe(2);
  });

  it("switches to UCS-2 for other characters (French accents outside GSM, emoji)", () => {
    expect(smsSegments("ç").encoding).toBe("UCS-2");
    expect(smsSegments("Ready 👍").encoding).toBe("UCS-2");
    expect(smsSegments("ê".repeat(70)).segments).toBe(1);
    expect(smsSegments("ê".repeat(71)).segments).toBe(2);
  });
});
