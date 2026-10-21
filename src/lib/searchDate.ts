import { addDays } from "./calendar";

// Typed dates in the main search (decision 102): "2026-10-20", "Oct 20",
// "October 20", "20 Oct", "Oct 20, 2026", "today", "tomorrow", "yesterday".
// No year means this year. Slashes (10/20 vs 20/10) are ambiguous in Canada,
// so they're not read as dates. Returns YYYY-MM-DD, or null when the text is
// not a date.

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** 1–12 for a month name or its start of 3+ letters ("oct", "octo", "sept."). */
function month(word: string): number | null {
  const w = word.replace(/\.$/, "");
  if (w.length < 3) return null;
  const i = MONTHS.findIndex((m) => m.startsWith(w));
  return i < 0 ? null : i + 1;
}

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** `today` is the shop's today as YYYY-MM-DD. */
export function parseSearchDate(text: string, today: string): string | null {
  const q = text.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (q === "today") return today;
  if (q === "tomorrow") return addDays(today, 1);
  if (q === "yesterday") return addDays(today, -1);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(q);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  const year = Number(today.slice(0, 4));
  // "oct 20", "oct 20 2026", "october 20th"
  m = /^([a-z.]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(q);
  if (m) {
    const mo = month(m[1] ?? "");
    return mo ? iso(m[3] ? Number(m[3]) : year, mo, Number(m[2])) : null;
  }
  // "20 oct", "20 oct 2026"
  m = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z.]+)(?: (\d{4}))?$/.exec(q);
  if (m) {
    const mo = month(m[2] ?? "");
    return mo ? iso(m[3] ? Number(m[3]) : year, mo, Number(m[1])) : null;
  }
  return null;
}
