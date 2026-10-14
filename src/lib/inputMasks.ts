// Typing rules for the shared money and phone inputs (UX plan v2, PR 2).
// Pure functions so they can be unit tested without a browser.

import { centsToInput, parseMoney } from "@/lib/money";

const MAX_MONEY_DIGITS = 11; // up to 999,999,999.99, the database's ceiling

/**
 * Cash-register entry: every digit typed fills from the cents side.
 * "1" → "0.01", "10" → "0.10", "100" → "1.00", "1000" → "10.00".
 * Removing the last digit shifts back the same way. No digits → "".
 * Returns the same "12.50" text format the rest of the app parses.
 */
export function moneyFromTyped(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "").slice(0, MAX_MONEY_DIGITS);
  if (!digits) return "";
  return centsToInput(Number(digits));
}

/**
 * Pasted text keeps its meaning ("12.5" is twelve fifty, not 1.25). Falls back
 * to cash-register reading if it isn't a plain amount.
 */
export function moneyFromPasted(text: string): string {
  const cents = parseMoney(text.trim());
  return cents === null ? moneyFromTyped(text) : centsToInput(cents);
}

/**
 * North American number as it's typed: "(416", "(416) 55", "(416) 555-0100".
 * A leading 1 is the country code (area codes never start with 1), shown as
 * "+1 (416) 555-0100". Anything starting with "+" and another country code is
 * left as typed, so an existing international number isn't mangled. The
 * database stores digits only, so the formatting never reaches it.
 */
export function formatPhoneTyped(raw: string): string {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("+") && !trimmed.startsWith("+1")) return trimmed.slice(0, 20);
  let digits = raw.replace(/\D/g, "");
  let prefix = "";
  if (digits.startsWith("1")) {
    prefix = "+1 ";
    digits = digits.slice(1);
  }
  digits = digits.slice(0, 10);
  if (!digits) return prefix.trim();
  const area = digits.slice(0, 3);
  const mid = digits.slice(3, 6);
  const last = digits.slice(6);
  let out = `(${area}`;
  if (digits.length > 3) out += `) ${mid}`;
  if (digits.length > 6) out += `-${last}`;
  return prefix + out;
}
