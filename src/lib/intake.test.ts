import { describe, expect, it } from "vitest";

import {
  dateFromIso,
  isoFromDate,
  lineAmounts,
  percentOf,
  previewTotals,
  titleFromText,
} from "./intake";

describe("titleFromText", () => {
  it("takes the first six words like the database does", () => {
    expect(titleFromText("  Brown boots need new heels and a full polish please")).toBe(
      "Brown boots need new heels and",
    );
    expect(titleFromText("Zip\n\nrepair")).toBe("Zip repair");
    expect(titleFromText("   ")).toBe("");
  });

  it("caps the title at 120 characters", () => {
    expect(titleFromText("x".repeat(200))).toHaveLength(120);
  });
});

describe("lineAmounts", () => {
  it("rounds half away from zero, in exact cents", () => {
    // 1.5 × 0.33 = 0.495 → 0.50
    expect(lineAmounts({ quantity: 1.5, unitPriceCents: 33, discount: null }).subtotalCents).toBe(
      50,
    );
    // 1.15 × 100 is 114.999… in floating point; the exact answer is 115.
    expect(lineAmounts({ quantity: 1.15, unitPriceCents: 100, discount: null }).subtotalCents).toBe(
      115,
    );
  });

  it("applies percent and fixed discounts and caps them at the line", () => {
    expect(
      lineAmounts({ quantity: 1, unitPriceCents: 5000, discount: { type: "percent", value: 10 } }),
    ).toEqual({ subtotalCents: 5000, discountCents: 500, totalCents: 4500 });
    expect(
      lineAmounts({ quantity: 2, unitPriceCents: 1000, discount: { type: "fixed", value: 5 } }),
    ).toEqual({ subtotalCents: 2000, discountCents: 500, totalCents: 1500 });
    expect(
      lineAmounts({ quantity: 1, unitPriceCents: 300, discount: { type: "fixed", value: 5 } })
        .totalCents,
    ).toBe(0);
  });
});

describe("previewTotals", () => {
  const hst = { id: "hst", name: "HST", rate: 13 };

  it("matches the database example in 015_ticket_intake", () => {
    const t = previewTotals(
      [
        { quantity: 1, unitPriceCents: 9000, discount: null, taxRateIds: ["hst"] },
        {
          quantity: 1,
          unitPriceCents: 5000,
          discount: { type: "percent", value: 10 },
          taxRateIds: [],
        },
      ],
      [hst],
    );
    expect(t).toMatchObject({
      subtotalBeforeCents: 14000,
      savingsCents: 500,
      subtotalCents: 13500,
      taxCents: 1170,
      totalCents: 14670,
    });
    expect(t.taxes).toEqual([{ ...hst, taxCents: 1170 }]);
  });

  it("rounds tax once per rate, not per line", () => {
    // Each line alone: 0.13 × 0.05 = 0.0065 → 0.01, twice = 0.02. Together: 0.013 → 0.01.
    const t = previewTotals(
      [
        { quantity: 1, unitPriceCents: 5, discount: null, taxRateIds: ["hst"] },
        { quantity: 1, unitPriceCents: 5, discount: null, taxRateIds: ["hst"] },
      ],
      [hst],
    );
    expect(t.taxCents).toBe(1);
  });

  it("handles fractional rates like QST", () => {
    const t = previewTotals(
      [{ quantity: 1, unitPriceCents: 10000, discount: null, taxRateIds: ["qst"] }],
      [{ id: "qst", name: "QST", rate: 9.975 }],
    );
    expect(t.taxCents).toBe(998);
  });

  it("is all zeros with no lines", () => {
    expect(previewTotals([], [hst]).totalCents).toBe(0);
  });

  describe("ticket discount (same numbers as 023_ticket_discount)", () => {
    const gst = { id: "gst", name: "GST", rate: 5 };
    const pst = { id: "pst", name: "PST", rate: 7 };
    const lines = [
      { quantity: 1, unitPriceCents: 3000, discount: null, taxRateIds: ["gst", "pst"] },
      { quantity: 1, unitPriceCents: 1000, discount: null, taxRateIds: ["gst"] },
    ];

    it("takes a percent off and lowers each rate's tax by its share", () => {
      const t = previewTotals(lines, [gst, pst], { type: "percent", value: 10 });
      expect(t).toMatchObject({
        ticketDiscountCents: 400,
        savingsCents: 400,
        subtotalCents: 3600,
        taxCents: 369,
        totalCents: 3969,
      });
    });

    it("rounds each share half away from zero", () => {
      expect(previewTotals(lines, [gst, pst], { type: "fixed", value: 5 }).totalCents).toBe(3859);
    });

    it("caps a fixed amount at the lines", () => {
      const t = previewTotals([lines[1]!], [gst], { type: "fixed", value: 50 });
      expect(t).toMatchObject({ ticketDiscountCents: 1000, taxCents: 0, totalCents: 0 });
    });
  });
});

describe("percentOf", () => {
  it("rounds to the cent", () => {
    expect(percentOf(14670, 50)).toBe(7335);
    expect(percentOf(999, 33.33)).toBe(333);
  });
});

describe("dates", () => {
  it("round-trips a calendar date without time zone drift", () => {
    expect(isoFromDate(dateFromIso("2026-11-01"))).toBe("2026-11-01");
    expect(isoFromDate(dateFromIso("2026-03-08"))).toBe("2026-03-08");
  });
});
