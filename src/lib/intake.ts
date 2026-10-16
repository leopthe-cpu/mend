import type { DiscountType } from "@/lib/money";

// Helpers for the new-ticket flow (UX plan v2, PR 6, decision 69).
//
// The database computes and stores every total (create_ticket_full →
// private.line_math / private.recalc_estimate). previewTotals only shows the
// same numbers while the ticket is being typed, so it mirrors that math
// exactly: integer cents, round half away from zero, discount per line, then
// the whole-ticket discount (decision 78), tax per rate on the sum of the lines
// carrying it minus that rate's share of the ticket discount, rounded once.

/** Same rule as private.title_from_text: the first six words, at most 120 characters. */
export function titleFromText(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 6).join(" ").slice(0, 120);
}

export type PreviewLine = {
  quantity: number;
  unitPriceCents: number;
  discount: { type: DiscountType; value: number } | null;
  taxRateIds: string[];
};
export type PreviewTax = { id: string; name: string; rate: number };
export type PreviewTotals = {
  subtotalBeforeCents: number;
  /** Line discounts plus the ticket discount. */
  savingsCents: number;
  ticketDiscountCents: number;
  subtotalCents: number;
  taxes: { id: string; name: string; rate: number; taxCents: number }[];
  taxCents: number;
  totalCents: number;
};

// round(a / b) half away from zero, for a >= 0 and b > 0, in exact integers.
// BigInt so large prices times a scaled rate can't lose precision.
function divRound(a: bigint, b: bigint): bigint {
  return (a * 2n + b) / (b * 2n);
}
// Fixed scale for decimals typed by people (quantities and percents have at
// most two decimals; tax rates at most four, e.g. QST 9.975).
const scaled = (n: number, digits: number) => BigInt(Math.round(n * 10 ** digits));

export function lineAmounts(l: Omit<PreviewLine, "taxRateIds">): {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
} {
  const subtotal = divRound(scaled(l.quantity, 2) * BigInt(l.unitPriceCents), 100n);
  let discount = 0n;
  if (l.discount?.type === "percent")
    discount = divRound(subtotal * scaled(l.discount.value, 2), 10000n);
  if (l.discount?.type === "fixed") discount = scaled(l.discount.value, 2);
  // The database refuses a manual discount above the line and caps a catalog
  // one; the preview just caps, the save shows the database's message.
  if (discount > subtotal) discount = subtotal;
  return {
    subtotalCents: Number(subtotal),
    discountCents: Number(discount),
    totalCents: Number(subtotal - discount),
  };
}

export function previewTotals(
  lines: PreviewLine[],
  taxes: PreviewTax[],
  ticketDiscount: { type: DiscountType; value: number } | null = null,
): PreviewTotals {
  let before = 0;
  let lineSavings = 0;
  const base = new Map<string, number>();
  for (const l of lines) {
    const a = lineAmounts(l);
    before += a.subtotalCents;
    lineSavings += a.discountCents;
    for (const id of new Set(l.taxRateIds)) base.set(id, (base.get(id) ?? 0) + a.totalCents);
  }
  const linesTotal = BigInt(before - lineSavings);
  // Same as private.recalc_estimate: a percent of the lines, or a fixed
  // amount capped at them (the database refuses more when it is set).
  let disc = 0n;
  if (ticketDiscount?.type === "percent")
    disc = divRound(linesTotal * scaled(ticketDiscount.value, 2), 10000n);
  if (ticketDiscount?.type === "fixed") disc = scaled(ticketDiscount.value, 2);
  if (disc > linesTotal) disc = linesTotal;
  const taxLines = taxes
    .filter((t) => base.has(t.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => {
      const b = BigInt(base.get(t.id) ?? 0);
      const taxable = linesTotal > 0n ? b - divRound(b * disc, linesTotal) : b;
      return { ...t, taxCents: Number(divRound(taxable * scaled(t.rate, 4), 1000000n)) };
    });
  const tax = taxLines.reduce((s, t) => s + t.taxCents, 0);
  const after = Number(linesTotal - disc);
  return {
    subtotalBeforeCents: before,
    savingsCents: lineSavings + Number(disc),
    ticketDiscountCents: Number(disc),
    subtotalCents: after,
    taxes: taxLines,
    taxCents: tax,
    totalCents: after + tax,
  };
}

/** A percentage of a total in cents, rounded like the database rounds. */
export function percentOf(totalCents: number, percent: number): number {
  return Number(divRound(BigInt(totalCents) * scaled(percent, 2), 10000n));
}

/** "2026-11-10" ↔ a local Date at midnight (the calendar works in local dates). */
export function dateFromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}
export function isoFromDate(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
