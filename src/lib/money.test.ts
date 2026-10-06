import { describe, expect, it } from "vitest";

import { centsToInput, discountActiveOn, formatMoney, parseMoney, parseQuantity } from "./money";

describe("parseMoney", () => {
  it.each([
    ["180", 18000],
    ["180.5", 18050],
    ["$1,234.56", 123456],
    [".5", 50],
    ["0.10", 10],
    ["0.29", 29], // 0.29 * 100 is 28.999… as a float; text parsing avoids that
    ["  42.00 ", 4200],
  ])("%s -> %i cents", (input, cents) => {
    expect(parseMoney(input)).toBe(cents);
  });

  it.each(["", "abc", "1.234", "-5", "1.2.3", "12a"])("rejects %j", (input) => {
    expect(parseMoney(input)).toBeNull();
  });
});

describe("other helpers", () => {
  it("round-trips cents to input text", () => {
    expect(centsToInput(42601)).toBe("426.01");
    expect(centsToInput(5)).toBe("0.05");
    expect(parseMoney(centsToInput(42601))).toBe(42601);
  });

  it("formats CAD", () => {
    expect(formatMoney(42601)).toBe("$426.01");
  });

  it("parses quantities", () => {
    expect(parseQuantity("2")).toBe(2);
    expect(parseQuantity("1.5")).toBe(1.5);
    expect(parseQuantity("0")).toBeNull();
    expect(parseQuantity("1.555")).toBeNull();
  });

  it("matches the database's inclusive discount dates", () => {
    const item = {
      discount_type: "percent" as const,
      discount_starts_on: null,
      discount_ends_on: "2026-11-30",
    };
    expect(discountActiveOn(item, "2026-11-30")).toBe(true);
    expect(discountActiveOn(item, "2026-12-01")).toBe(false);
  });
});
