import { describe, expect, it } from "vitest";

import { formatPhoneTyped, moneyFromPasted, moneyFromTyped } from "./inputMasks";

describe("moneyFromTyped (cash-register entry)", () => {
  it("fills from the cents side as digits are typed", () => {
    expect(moneyFromTyped("1")).toBe("0.01");
    expect(moneyFromTyped("0.011")).toBe("0.11");
    // Oz's example: 1, 0, 0 → 1.00; one more 0 → 10.00
    expect(moneyFromTyped("0.010")).toBe("0.10");
    expect(moneyFromTyped("0.100")).toBe("1.00");
    expect(moneyFromTyped("1.000")).toBe("10.00");
  });

  it("shifts back when the last digit is removed", () => {
    expect(moneyFromTyped("10.0")).toBe("1.00");
    expect(moneyFromTyped("0.0")).toBe("");
    expect(moneyFromTyped("")).toBe("");
  });

  it("ignores anything that isn't a digit and caps the length", () => {
    expect(moneyFromTyped("$1,2a3")).toBe("1.23");
    expect(moneyFromTyped("1234567890123")).toBe("123456789.01");
  });
});

describe("moneyFromPasted", () => {
  it("keeps the meaning of a pasted amount", () => {
    expect(moneyFromPasted("12.5")).toBe("12.50");
    expect(moneyFromPasted("$1,200")).toBe("1200.00");
  });

  it("falls back to digit entry for odd text", () => {
    expect(moneyFromPasted("12 dollars 50")).toBe("12.50");
  });
});

describe("formatPhoneTyped", () => {
  it("formats a North American number as it's typed", () => {
    expect(formatPhoneTyped("4")).toBe("(4");
    expect(formatPhoneTyped("416")).toBe("(416");
    expect(formatPhoneTyped("4165")).toBe("(416) 5");
    expect(formatPhoneTyped("416555")).toBe("(416) 555");
    expect(formatPhoneTyped("4165550")).toBe("(416) 555-0");
    expect(formatPhoneTyped("4165550100")).toBe("(416) 555-0100");
  });

  it("lets backspace through the punctuation", () => {
    // Deleting the space after "(416)" leaves three digits: back to "(416".
    expect(formatPhoneTyped("(416)")).toBe("(416");
    expect(formatPhoneTyped("(416) 555-")).toBe("(416) 555");
  });

  it("treats a leading 1 as the country code", () => {
    expect(formatPhoneTyped("14165550100")).toBe("+1 (416) 555-0100");
    expect(formatPhoneTyped("+14165550100")).toBe("+1 (416) 555-0100");
    expect(formatPhoneTyped("1")).toBe("+1");
  });

  it("caps at ten digits after the country code", () => {
    expect(formatPhoneTyped("41655501009999")).toBe("(416) 555-0100");
  });

  it("leaves other countries' numbers as typed", () => {
    expect(formatPhoneTyped("+44 20 7946 0958")).toBe("+44 20 7946 0958");
  });

  it("returns empty for empty input", () => {
    expect(formatPhoneTyped("")).toBe("");
  });
});
