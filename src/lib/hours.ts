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

// Shop days (decision 79). Dates are "YYYY-MM-DD" in the shop's time zone.
// The database has the same rules (private.shop_open_on, private.promised_text,
// private.pickup_hours_text in 20261024090000_shop_days.sql); keep them in step.

const JS_DAY: DayKey[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function weekdayOf(iso: string): DayKey {
  const [y, m, d] = iso.split("-").map(Number);
  return JS_DAY[new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()]!;
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
}

/** The schedule's entry for that date's weekday, if the shop set one. */
export function dayFor(schedule: WeeklySchedule | undefined, iso: string): DaySchedule | undefined {
  const day = weekdayOf(iso);
  return schedule?.find((s) => s.day === day);
}

/** Open that day? A shop without a weekly schedule (or with every day closed,
 *  which is a setup slip, not a real shop) counts as open every day. */
export function isOpenOn(schedule: WeeklySchedule | undefined, iso: string): boolean {
  if (!schedule?.some((s) => s.open)) return true;
  return dayFor(schedule, iso)?.open ?? false;
}

/** The next `count` open dates from `fromIso` (included), looking at most 60 days ahead. */
export function nextOpenDays(
  schedule: WeeklySchedule | undefined,
  fromIso: string,
  count: number,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < 60 && out.length < count; i++) {
    const iso = addDays(fromIso, i);
    if (isOpenOn(schedule, iso)) out.push(iso);
  }
  return out;
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** {promised_date}: "Mon, Oct 19 (open 9am–5pm)", or just the date without hours for that day. */
export function promisedDateText(iso: string, schedule: WeeklySchedule | undefined): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  if (Number.isNaN(date.getTime())) return "a date to be confirmed";
  const text = `${WEEKDAY_SHORT[date.getUTCDay()]}, ${MONTH_SHORT[date.getUTCMonth()]} ${date.getUTCDate()}`;
  const day = dayFor(schedule, iso);
  return day?.open
    ? `${text} (open ${formatHourLabel(day.opens)}–${formatHourLabel(day.closes)})`
    : text;
}

/**
 * {pickup_hours}: when the customer can come, from the moment the message is
 * written. "Open today until 5pm.", "Open today 9am–5pm." or "Next open: Mon
 * 9am–5pm." Day names, not "tomorrow", so a text held back by quiet hours
 * stays true. Without a weekly schedule, the shop's hours text.
 */
export function pickupHoursText(
  schedule: WeeklySchedule | undefined,
  fallback: string,
  timeZone: string,
  now = new Date(),
): string {
  if (!schedule?.some((s) => s.open)) return fallback;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const today = `${get("year")}-${get("month")}-${get("day")}`;
  const time = `${get("hour")}:${get("minute")}`;
  const t = dayFor(schedule, today);
  if (t?.open && time < t.closes)
    return time < t.opens
      ? `Open today ${formatHourLabel(t.opens)}–${formatHourLabel(t.closes)}.`
      : `Open today until ${formatHourLabel(t.closes)}.`;
  const next = nextOpenDays(schedule, addDays(today, 1), 1)[0];
  const n = next ? dayFor(schedule, next) : undefined;
  if (!next || !n) return fallback;
  return `Next open: ${DAY_SHORT[n.day]} ${formatHourLabel(n.opens)}–${formatHourLabel(n.closes)}.`;
}
