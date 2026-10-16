import { Check, Plus, X } from "lucide-react";
import { useState } from "react";

import { selectClass } from "@/components/app/Field";
import { MoneyInput } from "@/components/app/MaskedInputs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type CatalogItem,
  discountActiveOn,
  discountLabel,
  formatMoney,
  type TaxRate,
} from "@/lib/money";
import { friendlyDbError } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";

export type DraftLine = {
  key: string;
  item: CatalogItem | null;
  name: string;
  qty: string;
  price: string;
  taxIds: string[] | null;
};

const RATE_RE = /^\d{1,2}(\.\d{1,3})?$|^100(\.0{1,3})?$/;

/** One service row in the new-ticket form (decision 78 redesign): a single
 *  compact line with the name, quantity, line total and remove. Catalog
 *  discounts show under the name; manual discounts are for the whole ticket
 *  only. A new service (Admins) adds name and price inputs, and "Add tax". */
export function ServiceLine({
  line: l,
  isAdmin,
  shopId,
  taxes,
  today,
  currency,
  totalCents,
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
  /** The line's total after its catalog discount, from the dialog's preview. */
  totalCents: number;
  onChange: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
  /** A tax created inline is added to the shop's list, so it shows and counts. */
  onTaxCreated: (rate: TaxRate) => void;
}) {
  const id = `line-${l.key}`;
  const money = (c: number) => formatMoney(c, currency);
  const catalogDiscount =
    l.item?.discount_type && discountActiveOn(l.item, today)
      ? discountLabel(l.item.discount_type, l.item.discount_value ?? 0, currency)
      : null;
  const label = l.item?.name || l.name || "service";

  return (
    <li className="flex flex-col gap-2 px-3 py-2">
      {/* On phones the name gets its own line; the numbers sit below it. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
          {l.item ? (
            <>
              <p className="truncate">{l.item.name}</p>
              <p className="text-sm text-muted-foreground">
                {money(l.item.price_cents)}
                {l.item.unit === "hour" ? " per hour" : " each"}
                {catalogDiscount ? (
                  <span className="text-brand-text"> · {catalogDiscount}</span>
                ) : null}
              </p>
            </>
          ) : (
            <Input
              id={`${id}-name`}
              aria-label="New service name"
              value={l.name}
              onChange={(e) => onChange({ name: e.target.value })}
              maxLength={200}
              placeholder="New service"
              autoFocus
            />
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!l.item ? (
            <MoneyInput
              id={`${id}-price`}
              aria-label={`Price for ${label}`}
              className="w-24 text-right"
              value={l.price}
              onValueChange={(price) => onChange({ price })}
            />
          ) : null}
          <span className="text-sm text-muted-foreground" aria-hidden>
            ×
          </span>
          <Input
            id={`${id}-qty`}
            aria-label={l.item?.unit === "hour" ? `Hours for ${label}` : `Quantity of ${label}`}
            inputMode="decimal"
            className="w-14 text-center"
            value={l.qty}
            onChange={(e) => onChange({ qty: e.target.value.replace(/[^\d.]/g, "").slice(0, 8) })}
          />
          {l.item ? (
            <span className="w-20 text-right tabular-nums">{money(totalCents)}</span>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 shrink-0"
            aria-label={`Remove ${label}`}
            onClick={onRemove}
          >
            <X />
          </Button>
        </div>
      </div>

      {/* Tax for a new service (Admins only) */}
      {isAdmin && !l.item && l.taxIds === null && taxes.length ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start underline underline-offset-4"
          onClick={() => onChange({ taxIds: [] })}
        >
          <Plus /> Add tax
        </Button>
      ) : null}
      {isAdmin && !l.item && l.taxIds !== null ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Tax</span>
            {l.taxIds.map((tid) => {
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
                    onClick={() => onChange({ taxIds: l.taxIds!.filter((x) => x !== tid) })}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              );
            })}
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
                  onChange({ taxIds: [...(l.taxIds ?? []), e.target.value] });
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
