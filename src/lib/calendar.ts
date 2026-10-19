// Date math for the calendar page (decision 93). Dates are ISO "YYYY-MM-DD"
// strings in the shop's time zone, computed in UTC so no local offset or
// daylight-saving change can shift a day. Weeks start on Monday.

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y ?? 1970, m ?? 1, d ?? 1];
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = parts(iso);
  return toIso(new Date(Date.UTC(y, m - 1, d + n)));
}

/** 0 = Monday … 6 = Sunday. */
export function mondayIndex(iso: string): number {
  const [y, m, d] = parts(iso);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** The Monday of the week holding `iso`. */
export function weekStart(iso: string): string {
  return addDays(iso, -mondayIndex(iso));
}

/** The seven dates of the week holding `iso`, Monday first. */
export function weekDays(iso: string): string[] {
  const start = weekStart(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function monthStart(iso: string): string {
  const [y, m] = parts(iso);
  return toIso(new Date(Date.UTC(y, m - 1, 1)));
}

/** Same day of month in the next (+1) or previous (-1) month, clamped to its last day. */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = parts(iso);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return toIso(new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))));
}

/**
 * Whole weeks covering the month of `iso`, Monday first: 5 or 6 rows of 7.
 * `inMonth` marks the days of that month.
 */
export function monthGrid(iso: string): { iso: string; inMonth: boolean }[] {
  const first = monthStart(iso);
  const [y, m] = parts(first);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const start = weekStart(first);
  const cells = Math.ceil((mondayIndex(first) + days) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => {
    const day = addDays(start, i);
    return { iso: day, inMonth: day.slice(0, 7) === first.slice(0, 7) };
  });
}

export function dayOfMonth(iso: string): number {
  return parts(iso)[2];
}

export function weekdayShort(iso: string): string {
  return WEEKDAYS[mondayIndex(iso)] ?? "";
}

/** "October 2026". */
export function monthLabel(iso: string): string {
  const [y, m] = parts(iso);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "Oct 19 – 25", or "Oct 26 – Nov 1" across months, or with years across a new year. */
export function weekLabel(iso: string): string {
  const days = weekDays(iso);
  const a = days[0] ?? iso;
  const b = days[6] ?? iso;
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  const short = (mm: number) => MONTHS[mm - 1]?.slice(0, 3) ?? "";
  if (ay !== by) return `${short(am)} ${ad}, ${ay} – ${short(bm)} ${bd}, ${by}`;
  if (am !== bm) return `${short(am)} ${ad} – ${short(bm)} ${bd}`;
  return `${short(am)} ${ad} – ${bd}`;
}

/** Groups items by a date key; items without a date are left out. */
export function byDate<T>(items: T[], key: (t: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (!k) continue;
    const list = out.get(k);
    if (list) list.push(it);
    else out.set(k, [it]);
  }
  return out;
}

export function ticketCount(n: number): string {
  return n === 1 ? "1 ticket" : `${n} tickets`;
}
