import { getSupabase } from "@/lib/supabase";

// Money is integer cents everywhere. The database computes every total; the
// browser only formats and parses (decision P1: never floats for money).

export function formatMoney(cents: number, currency = "CAD"): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
}

/** Cents as a plain "12.50" for an input field. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * "$1,234.5" -> 123450. Parses the digits as text so 0.1 + 0.2 issues can't
 * creep in. Returns null for anything that isn't a non-negative amount with at
 * most two decimals.
 */
export function parseMoney(input: string): number | null {
  const s = input.replace(/[\s$,]/g, "");
  const m = /^(\d{1,9})(?:\.(\d{0,2}))?$|^\.(\d{1,2})$/.exec(s);
  if (!m) return null;
  const whole = m[1] ?? "0";
  const frac = (m[2] ?? m[3] ?? "").padEnd(2, "0");
  return Number(whole) * 100 + Number(frac);
}

/** Quantity like "2" or "1.5" (up to two decimals, above zero). */
export function parseQuantity(input: string): number | null {
  const s = input.trim();
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= 10000 ? n : null;
}

export type TaxRate = { id: string; name: string; rate: number; active: boolean };
export type DiscountType = "percent" | "fixed";
export type CatalogItem = {
  id: string;
  name: string;
  category: string | null;
  item_type: "part" | "labor" | "service";
  unit: "each" | "hour";
  price_cents: number;
  sku: string | null;
  discount_type: DiscountType | null;
  discount_value: number | null;
  discount_starts_on: string | null;
  discount_ends_on: string | null;
  archived_at: string | null;
  tax_rate_ids: string[];
};

export async function fetchTaxRates(shopId: string): Promise<TaxRate[]> {
  const { data, error } = await getSupabase()
    .from("tax_rates")
    .select("id, name, rate, active")
    .eq("shop_id", shopId)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, rate: Number(r.rate) })) as TaxRate[];
}

export async function fetchCatalog(shopId: string): Promise<CatalogItem[]> {
  const db = getSupabase();
  const [items, links] = await Promise.all([
    db
      .from("catalog_items")
      .select(
        "id, name, category, item_type, unit, price_cents, sku, discount_type, discount_value, discount_starts_on, discount_ends_on, archived_at",
      )
      .eq("shop_id", shopId)
      .order("category", { nullsFirst: true })
      .order("name"),
    db.from("catalog_item_tax_rates").select("catalog_item_id, tax_rate_id").eq("shop_id", shopId),
  ]);
  if (items.error) throw items.error;
  if (links.error) throw links.error;
  const byItem = new Map<string, string[]>();
  for (const l of links.data ?? []) {
    byItem.set(l.catalog_item_id, [...(byItem.get(l.catalog_item_id) ?? []), l.tax_rate_id]);
  }
  return (items.data ?? []).map((i) => ({
    ...i,
    price_cents: Number(i.price_cents),
    discount_value: i.discount_value === null ? null : Number(i.discount_value),
    tax_rate_ids: byItem.get(i.id) ?? [],
  })) as CatalogItem[];
}

/** Is the catalog discount active on a shop-local date (YYYY-MM-DD)? Both ends inclusive. */
export function discountActiveOn(
  item: Pick<CatalogItem, "discount_type" | "discount_starts_on" | "discount_ends_on">,
  day: string,
): boolean {
  if (!item.discount_type) return false;
  if (item.discount_starts_on && item.discount_starts_on > day) return false;
  if (item.discount_ends_on && item.discount_ends_on < day) return false;
  return true;
}

export function discountLabel(type: DiscountType, value: number, currency = "CAD"): string {
  return type === "percent"
    ? `${Number(value)}% off`
    : `${formatMoney(Math.round(value * 100), currency)} off`;
}
