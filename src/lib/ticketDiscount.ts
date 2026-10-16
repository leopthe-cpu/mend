import type { DiscountType } from "@/lib/money";

// The whole-ticket discount (decision 78) as typed: % or $ plus an amount.
export type TicketDiscountDraft = { type: DiscountType; value: string };

/** The draft as the database expects it, or an error message. */
export function parseTicketDiscount(
  d: TicketDiscountDraft,
): { ok: true; type: DiscountType; value: number } | { ok: false; message: string } {
  const v = d.value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(v) || Number(v) <= 0)
    return {
      ok: false,
      message: d.type === "percent" ? "Enter a percent, like 10." : "Enter an amount, like 5.00.",
    };
  if (d.type === "percent" && Number(v) > 100)
    return { ok: false, message: "A percent is 0 to 100." };
  return { ok: true, type: d.type, value: Number(v) };
}
