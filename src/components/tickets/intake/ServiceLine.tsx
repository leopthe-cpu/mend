import { Check, Plus, X } from "lucide-react";
import { useState } from "react";

import { Field, selectClass } from "@/components/app/Field";
import { MoneyInput } from "@/components/app/MaskedInputs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type CatalogItem,
  discountActiveOn,
  discountLabel,
  type DiscountType,
  formatMoney,
  type TaxRate,
} from "@/lib/money";
import { friendlyDbError } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";

export type Discount = { type: DiscountType; value: string; confirmed: boolean };
export type DraftLine = {
  key: string;
  item: CatalogItem | null;
  name: string;
  qty: string;
  price: string;
  taxIds: string[] | null;
  discount: Discount | null;
};

const RATE_RE = /^\d{1,2}(\.\d{1,3})?$|^100(\.0{1,3})?$/;

/** One service row in the new-ticket flow (PR 6b): combobox line, qty, price,
 *  plus inline discount (Admin, ✓ confirmed) and tax (Admin, new services). */
export function ServiceLine({
  line: l,
  isAdmin,
  shopId,
  taxes,
  today,
  currency,
  onChange,
  onRemove,
  onTaxCreated,
}: {
  line: DraftLine;
  isAdmin: boolean;
  shopId: string;
  taxes: TaxRate[];
  today: string;
  currency: string;
  onChange: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
  /** A tax created inline is added to the shop's list, so it shows and counts. */
  onTaxCreated: (rate: TaxRate) => void;
}) {
  const id = `line-${l.key}`;
  const money = (c: number) => formatMoney(c, currency);
  const catalogDiscount =
    l.item?.discount_type && !l.discount && discountActiveOn(l.item, today)
      ? discountLabel(l.item.discount_type, l.item.discount_value ?? 0, currency)
      : null;
  const taxNames = (ids: string[]) =>
    taxes
      .filter((t) => ids.includes(t.id))
      .map((t) => t.name)
      .join(" + ");

  return (
    <li className="flex flex-col gap-3 rounded-md border border-border bg-surface-2 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          {l.item ? (
            <>
              <p className="text-sm font-medium">{l.item.name}</p>
              <p className="text-sm text-muted-foreground">
                {money(l.item.price_cents)}
                {l.item.unit === "hour" ? " per hour" : " each"}
                {l.item.tax_rate_ids.length ? ` · ${taxNames(l.item.tax_rate_ids)}` : ""}
                {catalogDiscount ? ` · ${catalogDiscount}` : ""}
              </p>
            </>
          ) : (
            <Field id={`${id}-name`} label="Service *">
              <Input
                id={`${id}-name`}
                value={l.name}
                onChange={(e) => onChange({ name: e.target.value })}
                maxLength={200}
                placeholder="What it's for"
                autoFocus
              />
            </Field>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0"
          aria-label={`Remove ${l.item?.name || l.name || "line"}`}
          onClick={onRemove}
        >
          <X />
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-20">
          <Field id={`${id}-qty`} label={l.item?.unit === "hour" ? "Hours" : "Qty"}>
            <Input
              id={`${id}-qty`}
              inputMode="decimal"
              value={l.qty}
              onChange={(e) =>
                onChange({
                  qty: e.target.value.replace(/[^\d.]/g, "").slice(0, 8),
                })
              }
            />
          </Field>
        </div>
        {!l.item ? (
          <div className="w-32">
            <Field id={`${id}-price`} label="Price *">
              <MoneyInput
                id={`${id}-price`}
                value={l.price}
                onValueChange={(price) => onChange({ price })}
              />
            </Field>
          </div>
        ) : null}
      </div>

      {/* Inline discount (Admins only, per line) */}
      {isAdmin && l.discount ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-28">
            <Field id={`${id}-dtype`} label="Discount">
              <select
                id={`${id}-dtype`}
                className={selectClass}
                value={l.discount.type}
                onChange={(e) =>
                  onChange({
                    discount: {
                      type: e.target.value as DiscountType,
                      value: l.discount?.value ?? "",
                      confirmed: false,
                    },
                  })
                }
              >
                <option value="percent">%</option>
                <option value="fixed">$ off</option>
              </select>
            </Field>
          </div>
          <div className="w-32">
            {l.discount.type === "fixed" ? (
              <MoneyInput
                aria-label="Discount amount"
                value={l.discount.value}
                onValueChange={(value) =>
                  onChange({
                    discount: { ...l.discount!, value, confirmed: false },
                  })
                }
              />
            ) : (
              <Input
                aria-label="Discount percent"
                inputMode="decimal"
                placeholder="10"
                value={l.discount.value}
                onChange={(e) =>
                  onChange({
                    discount: {
                      type: "percent",
                      value: e.target.value.replace(/[^\d.]/g, "").slice(0, 6),
                      confirmed: false,
                    },
                  })
                }
              />
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Confirm discount"
            disabled={!l.discount.value.trim()}
            onClick={() => onChange({ discount: { ...l.discount!, confirmed: true } })}
          >
            <Check />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="Remove discount"
            onClick={() => onChange({ discount: null })}
          >
            <X />
          </Button>
        </div>
      ) : null}

      {/* Inline tax (Admins only, new services only) */}
      {isAdmin && !l.item && l.taxIds !== null ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Tax</span>
            {l.taxIds.length
              ? l.taxIds.map((tid) => {
                  const t = taxes.find((x) => x.id === tid);
                  if (!t) return null;
                  return (
                    <span
                      key={tid}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-sm"
                    >
                      {t.name} ({t.rate}%)
                      <button
                        type="button"
                        aria-label={`Remove ${t.name}`}
                        className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          onChange({
                            taxIds: l.taxIds!.filter((id) => id !== tid),
                          })
                        }
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  );
                })
              : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label="Remove tax"
              onClick={() => onChange({ taxIds: null })}
            >
              <X />
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-44">
              <select
                aria-label="Pick a tax"
                className={selectClass}
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  onChange({
                    taxIds: [...(l.taxIds ?? []), e.target.value],
                  });
                }}
              >
                <option value="">Pick a tax…</option>
                {taxes
                  .filter((t) => !(l.taxIds ?? []).includes(t.id))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.rate}%)
                    </option>
                  ))}
              </select>
            </div>
            <InlineTaxCreator
              shopId={shopId}
              taxes={taxes}
              onCreated={(rate) => {
                onTaxCreated(rate);
                onChange({ taxIds: [...(l.taxIds ?? []), rate.id] });
              }}
            />
          </div>
        </div>
      ) : null}

      {/* Add buttons */}
      {isAdmin ? (
        <div className="flex flex-wrap gap-2">
          {!l.discount ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                onChange({
                  discount: { type: "percent", value: "", confirmed: false },
                })
              }
            >
              <Plus /> Add discount
            </Button>
          ) : null}
          {!l.item && l.taxIds === null && taxes.length ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange({ taxIds: [] })}
            >
              <Plus /> Add tax
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** Inline tax creator (PR 4 pattern): name + rate + ✓. Returns a TaxRate on
 *  successful creation. Shows an error when the insert fails. */
function InlineTaxCreator({
  shopId,
  taxes,
  onCreated,
}: {
  shopId: string;
  taxes: TaxRate[];
  onCreated: (rate: TaxRate) => void;
}) {
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!name.trim()) return;
    if (!RATE_RE.test(rate.trim())) return;
    setCreating(true);
    setError(null);
    const { data, error: err } = await getSupabase()
      .from("tax_rates")
      .insert({ shop_id: shopId, name: name.trim(), rate: Number(rate) })
      .select("id, name, rate, active")
      .single();
    setCreating(false);
    if (err || !data) {
      setError(err ? friendlyDbError(err) : "Only Admins can add taxes.");
      return;
    }
    onCreated(data as TaxRate);
    setName("");
    setRate("");
  }

  return (
    <>
      <div className="w-28">
        <Input
          aria-label="New tax name"
          value={name}
          maxLength={40}
          placeholder="HST"
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
        />
      </div>
      <div className="w-20">
        <Input
          aria-label="New tax rate"
          inputMode="decimal"
          value={rate}
          placeholder="13"
          onChange={(e) => {
            setRate(e.target.value);
            setError(null);
          }}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Confirm tax"
        disabled={creating || !name.trim()}
        onClick={() => void confirm()}
      >
        <Check />
      </Button>
      {error ? <p className="w-full text-sm text-danger">{error}</p> : null}
    </>
  );
}
