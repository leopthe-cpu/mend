import { Field, selectClass } from "@/components/app/Field";
import { MoneyInput } from "@/components/app/MaskedInputs";
import { formatMoney } from "@/lib/money";

export type PayMode = "later" | "full" | "deposit";

/**
 * Payment dropdown for the new-ticket flow (PR 6b): one select with three
 * options — Pay at pick-up (default), Paid (shown only when there is a
 * total), and Deposit (shows a MoneyInput when selected).  The label appears
 * once; the caller wraps it in a section heading if needed.
 */
export function PaymentField({
  payMode,
  onPayModeChange,
  depositAmount,
  onDepositAmountChange,
  hasTotal,
  total,
  currency,
}: {
  payMode: PayMode;
  onPayModeChange: (mode: PayMode) => void;
  depositAmount: string;
  onDepositAmountChange: (value: string) => void;
  hasTotal: boolean;
  total: number;
  currency: string;
}) {
  const money = (c: number) => formatMoney(c, currency);

  return (
    <div className="flex flex-col gap-3">
      <Field id="pay-mode" label="Payment">
        <select
          id="pay-mode"
          className={selectClass}
          value={payMode}
          onChange={(e) => onPayModeChange(e.target.value as PayMode)}
        >
          <option value="later">Pay at pick-up</option>
          {hasTotal ? <option value="full">Paid</option> : null}
          <option value="deposit">Deposit</option>
        </select>
      </Field>
      {payMode === "deposit" ? (
        <Field
          id="deposit"
          label="Deposit *"
          hint={hasTotal ? `At most ${money(total)}` : undefined}
        >
          <MoneyInput id="deposit" value={depositAmount} onValueChange={onDepositAmountChange} />
        </Field>
      ) : null}
    </div>
  );
}
