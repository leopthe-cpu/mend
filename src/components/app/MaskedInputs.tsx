import * as React from "react";

import { Input } from "@/components/ui/input";
import { formatPhoneTyped, moneyFromPasted, moneyFromTyped } from "@/lib/inputMasks";

type BaseProps = Omit<React.ComponentProps<"input">, "value" | "onChange" | "type">;

/** Keep the caret at the end: both masks only ever add or remove at the end. */
function caretToEnd(el: HTMLInputElement) {
  requestAnimationFrame(() => {
    const end = el.value.length;
    el.setSelectionRange(end, end);
  });
}

/**
 * Money field with cash-register entry (UX plan v2): "0.00" is only a
 * placeholder; typed digits fill from the cents side. The value is the same
 * "12.50" text the rest of the app reads with parseMoney().
 */
export const MoneyInput = React.forwardRef<
  HTMLInputElement,
  BaseProps & { value: string; onValueChange: (value: string) => void }
>(({ value, onValueChange, placeholder = "0.00", ...props }, ref) => (
  <Input
    ref={ref}
    {...props}
    type="text"
    inputMode="numeric"
    autoComplete="off"
    placeholder={placeholder}
    // A stored value like "5" shows as "5.00", so typing continues from it.
    value={value && !/^\d+\.\d{2}$/.test(value) ? moneyFromPasted(value) : value}
    onChange={(e) => {
      onValueChange(moneyFromTyped(e.target.value));
      caretToEnd(e.target);
    }}
    onPaste={(e) => {
      e.preventDefault();
      onValueChange(moneyFromPasted(e.clipboardData.getData("text")));
      caretToEnd(e.currentTarget);
    }}
    onFocus={(e) => {
      caretToEnd(e.target);
      props.onFocus?.(e);
    }}
  />
));
MoneyInput.displayName = "MoneyInput";

/**
 * Phone field formatted as (416) 555-0100 while typing. The database keeps
 * digits only (private.normalize_phone), so the formatting is display only.
 */
export const PhoneInput = React.forwardRef<
  HTMLInputElement,
  BaseProps & { value: string; onValueChange: (value: string) => void }
>(({ value, onValueChange, placeholder = "(416) 555-0100", ...props }, ref) => (
  <Input
    ref={ref}
    {...props}
    type="tel"
    inputMode="tel"
    autoComplete={props.autoComplete ?? "tel"}
    placeholder={placeholder}
    value={formatPhoneTyped(value)}
    onChange={(e) => {
      onValueChange(formatPhoneTyped(e.target.value));
      caretToEnd(e.target);
    }}
  />
));
PhoneInput.displayName = "PhoneInput";
