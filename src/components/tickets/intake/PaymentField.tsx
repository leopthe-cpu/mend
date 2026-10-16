import { MoneyInput } from "@/components/app/MaskedInputs";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export type PayMode = "later" | "full" | "deposit";

const OPTIONS: { mode: PayMode; label: string }[] = [
  { mode: "later", label: "Pay at pick-up" },
  { mode: "full", label: "Paid in full" },
  { mode: "deposit", label: "Deposit" },
];

/**
 * Payment for the new-ticket form (decision 78 redesign): three buttons, Pay
 * at pick-up (default), Paid in full (needs a total) and Deposit, which shows
 * the amount and what is left to pay at pick-up.
 */
export function PaymentField({
  payMode,
  onPayModeChange,
  depositAmount,
  onDepositAmountChange,
  depositCents,
  hasTotal,
  total,
  currency,
}: {
  payMode: PayMode;
  onPayModeChange: (mode: PayMode) => void;
  depositAmount: string;
  onDepositAmountChange: (value: string) => void;
  depositCents: number;
  hasTotal: boolean;
  total: number;
  currency: string;
}) {
  const money = (c: number) => formatMoney(c, currency);

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Payment</h3>
      <div role="group" aria-label="Payment" className="grid grid-cols-3 gap-2">
        {OPTIONS.map((o) => {
          const on = payMode === o.mode;
          const disabled = o.mode === "full" && !hasTotal;
          return (
            <button
              key={o.mode}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              title={disabled ? "Add a service with a price first" : undefined}
              onClick={() => onPayModeChange(o.mode)}
              className={cn(
                "min-h-12 rounded-md border px-2 text-sm leading-tight sm:text-base",
                on
                  ? "border-primary bg-primary font-semibold text-primary-foreground"
                  : "border-input bg-surface-2 hover:bg-accent",
                disabled && "cursor-not-allowed opacity-50 hover:bg-surface-2",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {payMode === "deposit" ? (
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="deposit" className="text-sm">
            Deposit
          </label>
          <MoneyInput
            id="deposit"
            className="w-32 text-right"
            value={depositAmount}
            onValueChange={onDepositAmountChange}
          />
          {hasTotal && depositCents > 0 && depositCents <= total ? (
            <span className="text-sm text-muted-foreground">
              {money(total - depositCents)} due at pick-up
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
