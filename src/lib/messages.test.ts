import { describe, expect, it } from "vitest";

import { formatPromisedDate, renderTemplate, smsPlainText, smsSegments } from "./messages";

const vars = {
  customer_name: "Maria Rossi",
  item_name: "winter coat",
  shop_name: "Tailor and Cleaners",
  ticket_number: 1042,
  pickup_hours: "Mon-Sat 9-6",
};

describe("renderTemplate", () => {
  it("renders the spec's default Ready template (full customer name)", () => {
    expect(
      renderTemplate(
        "Hi {customer_name}, your {item_name} is ready for pickup at {shop_name}. {pickup_hours}",
        vars,
      ),
    ).toBe(
      "Hi Maria Rossi, your winter coat is ready for pickup at Tailor and Cleaners. Mon-Sat 9-6",
    );
  });

  it("handles a missing pickup time and repeated variables", () => {
    expect(
      renderTemplate("Ticket {ticket_number}: {item_name} ({item_name}). {pickup_hours}", {
        ...vars,
        pickup_hours: "",
      }),
    ).toBe("Ticket #1042: winter coat (winter coat).");
  });

  it("matches the SQL renderer on the parity fixture", () => {
    const fixture = {
      customer_first_name: "Maria",
      customer_name: "Maria Rossi",
      shop_name: "Tailor and Cleaners",
      ticket_title: "winter coat",
      item_name: "winter coat",
      ticket_number: 1042,
      promised_date: "Tue, Oct 20",
      shop_hours: "Mon-Sat 9-6",
      pickup_hours: "Mon-Sat 9-6",
      amount_due: "$100.00",
      payment_line: "Payment of $100.00 is due at pick-up.",
    };
    expect(
      renderTemplate(
        "Hi {customer_first_name}, thanks for visiting {shop_name}. Your order {ticket_title} ({ticket_number}) will be ready on {promised_date}. {payment_line}",
        fixture,
      ),
    ).toBe(
      "Hi Maria, thanks for visiting Tailor and Cleaners. Your order winter coat (#1042) will be ready on Tue, Oct 20. Payment of $100.00 is due at pick-up.",
    );
  });
});

describe("formatPromisedDate", () => {
  it("matches SQL to_char(date, 'Dy, Mon DD')", () => {
    expect(formatPromisedDate("2026-10-20")).toBe("Tue, Oct 20");
  });

  it("falls back for an empty date", () => {
    expect(formatPromisedDate("")).toBe("a date to be confirmed");
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

describe("smsPlainText (same as private.sms_plain_text)", () => {
  it("swaps characters that would make a text UCS-2", () => {
    expect(
      smsPlainText("It\u2019s ready \u2013 open 9am\u20135pm\u2026 \u201Cthanks\u201D, Zoë"),
    ).toBe('It\'s ready - open 9am-5pm... "thanks", Zoë');
  });
  it("so an en dash no longer costs an extra segment", () => {
    expect(smsSegments("Open today 9am\u20135pm. " + "a".repeat(130))).toMatchObject({
      encoding: "GSM-7",
      segments: 1,
    });
  });
});
