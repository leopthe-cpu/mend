import { z } from "zod";

// Shared types for the weekly shop-hours editor and its summary (PR 3, v2).
// The shop stores these in shops.business_hours alongside the generated text.

export const DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const dayScheduleSchema = z.object({
  day: z.enum(DAY_KEYS),
  open: z.boolean(),
  opens: z.string().regex(/^\d{2}:\d{2}$/),
  closes: z.string().regex(/^\d{2}:\d{2}$/),
});
export type DaySchedule = z.infer<typeof dayScheduleSchema>;

export const weeklyScheduleSchema = z.array(dayScheduleSchema).length(7);
export type WeeklySchedule = z.infer<typeof weeklyScheduleSchema>;

const DAY_SHORT: Record<DayKey, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

const DAY_ORDER = DAY_KEYS as readonly DayKey[];

export function defaultSchedule(): WeeklySchedule {
  return DAY_KEYS.map((day) => {
    const isWeekday = day !== "saturday" && day !== "sunday";
    return { day, open: isWeekday, opens: "09:00", closes: "17:00" };
  });
}

/** "09:00" → "9am", "14:30" → "2:30pm", "12:00" → "12pm". */
export function formatHourLabel(t: string): string {
  const [h = 0, m = 0] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const hour = h % 12 || 12;
  return m === 0 ? `${hour}${ampm}` : `${hour}:${String(m).padStart(2, "0")}${ampm}`;
}

/**
 * Build a readable summary string from a weekly schedule by grouping
 * consecutive open days that share the same hours.  A closed day breaks
 * the group.  "Mon–Fri 9am–5pm, Sat 10am–4pm".
 */
export function scheduleToText(schedule: WeeklySchedule): string {
  const byDay = new Map(schedule.map((s) => [s.day, s]));
  const groups: { days: string[]; hours: string }[] = [];
  let gap = false;

  for (const day of DAY_ORDER) {
    const s = byDay.get(day);
    if (!s || !s.open) {
      gap = true;
      continue;
    }
    const label = `${formatHourLabel(s.opens)}–${formatHourLabel(s.closes)}`;
    const last = groups[groups.length - 1];
    if (last && !gap && last.hours === label) {
      last.days.push(DAY_SHORT[day]);
    } else {
      groups.push({ days: [DAY_SHORT[day]], hours: label });
    }
    gap = false;
  }

  return groups
    .map((g) => {
      const days =
        g.days.length > 2 ? `${g.days[0]}–${g.days[g.days.length - 1]}` : g.days.join(", ");
      return `${days} ${g.hours}`;
    })
    .join(", ");
}
