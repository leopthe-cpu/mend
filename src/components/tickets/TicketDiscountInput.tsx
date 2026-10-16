import { MoneyInput } from "@/components/app/MaskedInputs";
import { Input } from "@/components/ui/input";
import type { DiscountType } from "@/lib/money";
import { cn } from "@/lib/utils";

// The whole-ticket discount control (decision 78): % or $ plus an amount.
// Shared by the new-ticket form and the ticket's estimate, so both look and
// validate the same way.

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

export function TicketDiscountInput({
  id,
  draft,
  onChange,
}: {
  id: string;
  draft: TicketDiscountDraft;
  onChange: (d: TicketDiscountDraft) => void;
}) {
  const seg = (on: boolean) =>
    cn(
      "h-11 min-w-11 px-3 font-semibold focus-visible:z-10",
      on ? "bg-primary text-primary-foreground" : "bg-surface-2 text-foreground hover:bg-accent",
    );
  return (
    <div className="flex items-center gap-2">
      <div
        role="group"
        aria-label="Discount type"
        className="flex shrink-0 overflow-hidden rounded-md border border-input"
      >
        <button
          type="button"
          aria-pressed={draft.type === "percent"}
          className={seg(draft.type === "percent")}
          onClick={() => onChange({ type: "percent", value: "" })}
        >
          %
        </button>
        <button
          type="button"
          aria-pressed={draft.type === "fixed"}
          className={seg(draft.type === "fixed")}
          onClick={() => onChange({ type: "fixed", value: "" })}
        >
          $
        </button>
      </div>
      {draft.type === "fixed" ? (
        <MoneyInput
          id={id}
          aria-label="Discount amount"
          className="w-28"
          value={draft.value}
          onValueChange={(value) => onChange({ ...draft, value })}
        />
      ) : (
        <Input
          id={id}
          aria-label="Discount percent"
          inputMode="decimal"
          className="w-24 text-right"
          value={draft.value}
          onChange={(e) => onChange({ ...draft, value: e.target.value })}
        />
      )}
    </div>
  );
}
