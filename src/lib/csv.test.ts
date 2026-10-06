import { describe, expect, it } from "vitest";

import { csvCell, toCsv } from "./csv";

describe("csv", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('Coat, "wool"')).toBe('"Coat, ""wool"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });
  it("neutralises formulas in text", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1 416 555 0100")).toBe("'+1 416 555 0100");
    expect(csvCell("@cmd")).toBe("'@cmd");
  });
  it("leaves numbers, including negatives, as numbers", () => {
    expect(csvCell(-12.5)).toBe("-12.5");
    expect(csvCell(0)).toBe("0");
  });
  it("writes empty cells for null and undefined", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
  it("builds rows with CRLF", () => {
    expect(toCsv(["a", "b"], [[1, "x"]])).toBe("a,b\r\n1,x\r\n");
  });
});
