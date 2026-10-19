import { describe, expect, it } from "vitest";

import { parseSearchDate } from "./searchDate";

const today = "2026-10-19";

describe("parseSearchDate", () => {
  it("reads ISO dates and rejects impossible ones", () => {
    expect(parseSearchDate("2026-10-20", today)).toBe("2026-10-20");
    expect(parseSearchDate("2026-2-3", today)).toBe("2026-02-03");
    expect(parseSearchDate("2026-02-30", today)).toBeNull();
  });

  it("reads month names in either order, this year by default", () => {
    expect(parseSearchDate("Oct 20", today)).toBe("2026-10-20");
    expect(parseSearchDate("october 20th", today)).toBe("2026-10-20");
    expect(parseSearchDate("20 Oct", today)).toBe("2026-10-20");
    expect(parseSearchDate("Sept. 3", today)).toBe("2026-09-03");
    expect(parseSearchDate("Oct 20, 2027", today)).toBe("2027-10-20");
    expect(parseSearchDate("Feb 29", today)).toBeNull(); // 2026 isn't a leap year
  });

  it("knows today, tomorrow and yesterday", () => {
    expect(parseSearchDate("Today", today)).toBe("2026-10-19");
    expect(parseSearchDate("tomorrow", today)).toBe("2026-10-20");
    expect(parseSearchDate("yesterday", "2026-01-01")).toBe("2025-12-31");
  });

  it("leaves names, numbers and slashes alone", () => {
    expect(parseSearchDate("May", today)).toBeNull();
    expect(parseSearchDate("Mayer 3", today)).toBeNull();
    expect(parseSearchDate("1004", today)).toBeNull();
    expect(parseSearchDate("10/20", today)).toBeNull();
    expect(parseSearchDate("ju 3", today)).toBeNull();
  });
});
