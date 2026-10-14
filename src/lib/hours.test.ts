import { describe, expect, it } from "vitest";

import { defaultSchedule, scheduleToText, type DaySchedule } from "./hours";

function s(overrides: Partial<DaySchedule> & { day: DaySchedule["day"] }): DaySchedule {
  return { open: true, opens: "09:00", closes: "17:00", ...overrides };
}

function c(day: DaySchedule["day"]): DaySchedule {
  return { day, open: false, opens: "09:00", closes: "17:00" };
}

const DAYS: DaySchedule["day"][] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

describe("scheduleToText", () => {
  it("groups all open days with identical hours into a range", () => {
    const schedule = DAYS.map((day) =>
      day === "saturday" || day === "sunday" ? c(day) : s({ day }),
    );
    expect(scheduleToText(schedule)).toBe("Mon–Fri 9am–5pm");
  });

  it("groups a span and a separate day with different hours", () => {
    const schedule = [
      s({ day: "monday" }),
      s({ day: "tuesday" }),
      s({ day: "wednesday" }),
      s({ day: "thursday" }),
      s({ day: "friday" }),
      s({ day: "saturday", opens: "10:00", closes: "16:00" }),
      c("sunday"),
    ];
    expect(scheduleToText(schedule)).toBe("Mon–Fri 9am–5pm, Sat 10am–4pm");
  });

  it("lists non-consecutive open days separately", () => {
    const schedule = [
      s({ day: "monday" }),
      c("tuesday"),
      s({ day: "wednesday" }),
      c("thursday"),
      s({ day: "friday" }),
      c("saturday"),
      c("sunday"),
    ];
    expect(scheduleToText(schedule)).toBe(
      "Mon 9am–5pm, Wed 9am–5pm, Fri 9am–5pm",
    );
  });

  it("returns empty string when every day is closed", () => {
    expect(scheduleToText(DAYS.map((day) => c(day)))).toBe("");
  });

  it("shows a single open day", () => {
    const schedule = [
      s({ day: "thursday" }),
      c("friday"),
      c("saturday"),
      c("sunday"),
      c("monday"),
      c("tuesday"),
      c("wednesday"),
    ];
    expect(scheduleToText(schedule)).toBe("Thu 9am–5pm");
  });

  it("handles half-hour times", () => {
    const schedule = [
      s({ day: "monday", opens: "09:30", closes: "17:30" }),
      s({ day: "tuesday", opens: "09:30", closes: "17:30" }),
      s({ day: "wednesday", opens: "09:30", closes: "17:30" }),
      s({ day: "thursday", opens: "09:30", closes: "17:30" }),
      s({ day: "friday", opens: "09:30", closes: "17:30" }),
      c("saturday"),
      c("sunday"),
    ];
    expect(scheduleToText(schedule)).toBe("Mon–Fri 9:30am–5:30pm");
  });

  it("handles noon", () => {
    const schedule = [
      s({ day: "monday", opens: "12:00", closes: "13:00" }),
      c("tuesday"),
      c("wednesday"),
      c("thursday"),
      c("friday"),
      c("saturday"),
      c("sunday"),
    ];
    expect(scheduleToText(schedule)).toBe("Mon 12pm–1pm");
  });

  it("uses a comma for exactly two days", () => {
    const schedule = [
      s({ day: "monday" }),
      s({ day: "tuesday" }),
      c("wednesday"),
      c("thursday"),
      c("friday"),
      c("saturday"),
      c("sunday"),
    ];
    expect(scheduleToText(schedule)).toBe("Mon, Tue 9am–5pm");
  });

  it("preserves weekday order regardless of array position", () => {
    const schedule = [
      c("monday"),
      s({ day: "tuesday" }),
      c("wednesday"),
      s({ day: "thursday" }),
      c("friday"),
      c("saturday"),
      c("sunday"),
    ];
    expect(scheduleToText(schedule)).toBe("Tue 9am–5pm, Thu 9am–5pm");
  });

  it("handles morning-only hours", () => {
    const schedule = [
      c("monday"),
      c("tuesday"),
      c("wednesday"),
      c("thursday"),
      c("friday"),
      s({ day: "saturday", opens: "08:00", closes: "12:00" }),
      s({ day: "sunday", opens: "08:00", closes: "12:00" }),
    ];
    expect(scheduleToText(schedule)).toBe("Sat, Sun 8am–12pm");
  });

  it("defaultSchedule has five open weekdays", () => {
    const schedule = defaultSchedule();
    expect(schedule.filter((d) => d.open)).toHaveLength(5);
  });
});