import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  byDate,
  monthGrid,
  monthLabel,
  shortDate,
  ticketCount,
  weekDays,
  weekLabel,
  weekStart,
} from "./calendar";

describe("calendar dates", () => {
  it("starts weeks on Monday", () => {
    expect(weekStart("2026-10-19")).toBe("2026-10-19"); // Monday
    expect(weekStart("2026-10-25")).toBe("2026-10-19"); // Sunday
    expect(weekDays("2026-10-22")).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
  });

  it("crosses month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
  });

  it("is not shifted by daylight saving (Nov 1 2026 in Toronto)", () => {
    expect(weekDays("2026-11-01")[6]).toBe("2026-11-01");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });

  it("builds whole weeks for a month", () => {
    const oct = monthGrid("2026-10-07"); // Oct 1 2026 is a Thursday
    expect(oct).toHaveLength(35);
    expect(oct[0]).toEqual({ iso: "2026-09-28", inMonth: false });
    expect(oct[3]).toEqual({ iso: "2026-10-01", inMonth: true });
    expect(oct.filter((c) => c.inMonth)).toHaveLength(31);
    expect(monthGrid("2026-02-10")).toHaveLength(35); // Feb 2026 starts on a Sunday
    expect(monthGrid("2026-08-10")).toHaveLength(42); // Aug 2026: Sat 1 to Mon 31
  });

  it("labels weeks and months", () => {
    expect(weekLabel("2026-10-21")).toBe("Oct 19 – 25");
    expect(weekLabel("2026-10-28")).toBe("Oct 26 – Nov 1");
    expect(weekLabel("2026-12-30")).toBe("Dec 28, 2026 – Jan 3, 2027");
    expect(monthLabel("2026-10-19")).toBe("October 2026");
    expect(ticketCount(1)).toBe("1 ticket");
    expect(ticketCount(0)).toBe("0 tickets");
  });

  it("groups by date and skips undated items", () => {
    const m = byDate(
      [
        { id: 1, d: "2026-10-19" },
        { id: 2, d: null },
        { id: 3, d: "2026-10-19" },
      ],
      (t) => t.d,
    );
    expect(m.get("2026-10-19")?.map((t) => t.id)).toEqual([1, 3]);
    expect(m.size).toBe(1);
  });
});

describe("shortDate", () => {
  it("shows month and day", () => {
    expect(shortDate("2026-10-28")).toBe("Oct 28");
    expect(shortDate("2026-01-05", "2026-10-20")).toBe("Jan 5");
  });
  it("adds the year when it isn't this year", () => {
    expect(shortDate("2027-02-01", "2026-10-20")).toBe("Feb 1, 2027");
  });
  it("leaves anything else as it is", () => {
    expect(shortDate("soon")).toBe("soon");
  });
});
