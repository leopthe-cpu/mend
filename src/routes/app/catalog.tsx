import { createFileRoute } from "@tanstack/react-router";
import { Archive, ArchiveRestore, Pencil, Plus, Search, Tag, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/app/EmptyState";
import { Field, selectClass } from "@/components/app/Field";
import { FormAlert } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  type CatalogItem,
  centsToInput,
  discountActiveOn,
  discountLabel,
  type DiscountType,
  fetchCatalog,
  fetchTaxRates,
  formatMoney,
  parseMoney,
  type TaxRate,
} from "@/lib/money";
import { friendlyDbError, roleAtLeast } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import { shopToday } from "@/lib/tickets";

export const Route = createFileRoute("/app/catalog")({
  head: () => ({ meta: [{ title: "Catalog · Mend" }] }),
  component: CatalogPage,
});

const TYPES = [
  { value: "service", label: "Service" },
  { value: "part", label: "Part" },
  { value: "labor", label: "Labour" },
] as const;

type Msg = { tone: "error" | "info"; text: string } | null;

/** Unit price after the catalog discount, as the database computes it for one unit. */
function salePrice(i: CatalogItem): number {
  const off =
    i.discount_type === "percent"
      ? Math.round((i.price_cents * (i.discount_value ?? 0)) / 100)
      : Math.round((i.discount_value ?? 0) * 100);
  return Math.max(0, i.price_cents - off);
}

function CatalogPage() {
  const { membership } = Route.useRouteContext();
  const shop = membership.shop;
  const isOwner = roleAtLeast(membership.role, "owner");
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [taxes, setTaxes] = useState<TaxRate[]>([]);
  const [costs, setCosts] = useState<Map<string, number>>(new Map());
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<CatalogItem | "new" | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const today = shopToday(shop.time_zone);

  const load = useCallback(async () => {
    try {
      const [c, t] = await Promise.all([fetchCatalog(shop.id), fetchTaxRates(shop.id)]);
      setItems(c);
      setTaxes(t);
      if (isOwner) {
        // RLS returns nothing for non-owners anyway; skip the request.
        const { data, error } = await getSupabase()
          .from("catalog_item_costs")
          .select("catalog_item_id, cost_cents")
          .eq("shop_id", shop.id);
        if (error) throw error;
        setCosts(new Map((data ?? []).map((r) => [r.catalog_item_id, Number(r.cost_cents)])));
      }
    } catch (e) {
      setMsg({ tone: "error", text: friendlyDbError(e) });
    }
  }, [shop.id, isOwner]);
  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter(
      (i) =>
        (showArchived || !i.archived_at) &&
        (!q ||
          i.name.toLowerCase().includes(q) ||
          (i.category ?? "").toLowerCase().includes(q) ||
          (i.sku ?? "").toLowerCase().includes(q)),
    );
  }, [items, query, showArchived]);

  async function setArchived(item: CatalogItem, archived: boolean) {
    setMsg(null);
    const { data, error } = await getSupabase()
      .from("catalog_items")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", item.id)
      .select("id");
    if (error || !data?.length)
      return setMsg({
        tone: "error",
        text: error ? friendlyDbError(error) : "Only the owner can change the catalog.",
      });
    setMsg({ tone: "info", text: archived ? `${item.name} archived.` : `${item.name} restored.` });
    await load();
  }

  async function remove(item: CatalogItem) {
    if (!window.confirm(`Delete "${item.name}"? This can't be undone.`)) return;
    setMsg(null);
    const { data, error } = await getSupabase()
      .from("catalog_items")
      .delete()
      .eq("id", item.id)
      .select("id");
    if (error || !data?.length)
      return setMsg({
        tone: "error",
        text: error ? friendlyDbError(error) : "Only the owner can change the catalog.",
      });
    setMsg({ tone: "info", text: `${item.name} deleted.` });
    await load();
  }

  return (
    <>
      <PageHeader title="Catalog">
        {isOwner ? (
          <Button onClick={() => setEditing("new")}>
            <Plus /> Add item
          </Button>
        ) : null}
      </PageHeader>
      <div className="flex max-w-5xl flex-col gap-4">
        {!isOwner ? (
          <FormAlert tone="info">
            Only the shop owner can change prices. You can use these items on estimates.
          </FormAlert>
        ) : null}
        {msg ? <FormAlert tone={msg.tone}>{msg.text}</FormAlert> : null}

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-60 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              aria-label="Search the catalog"
              placeholder="Search by name, category or SKU"
              className="pl-10"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="size-5"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
        </div>

        {items === null ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-6 text-muted-foreground">
            {items.length === 0
              ? isOwner
                ? "No items yet. Add the services and parts you sell."
                : "No items yet. The owner adds them."
              : "Nothing matches."}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {visible.map((i) => {
              // Expired discounts drop out of this view on their own (spec §7.6).
              const active = discountActiveOn(i, today);
              const upcoming =
                !!i.discount_type && !!i.discount_starts_on && i.discount_starts_on > today;
              const taxNames = taxes
                .filter((t) => i.tax_rate_ids.includes(t.id))
                .map((t) => t.name)
                .join(", ");
              return (
                <li
                  key={i.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {i.name}
                      {i.archived_at ? (
                        <span className="ml-2 rounded border border-border px-1.5 text-sm font-normal text-muted-foreground">
                          Archived
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {[
                        i.category,
                        TYPES.find((t) => t.value === i.item_type)?.label,
                        i.unit === "hour" ? "per hour" : null,
                        i.sku ? `SKU ${i.sku}` : null,
                        taxNames || "No tax",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      {active && i.discount_type ? (
                        <>
                          <p className="text-sm text-muted-foreground line-through">
                            {formatMoney(i.price_cents, shop.currency)}
                          </p>
                          <p className="font-semibold">
                            {formatMoney(salePrice(i), shop.currency)}
                          </p>
                          <p className="text-sm text-success">
                            <Tag className="mr-1 inline size-4" aria-hidden />
                            {discountLabel(i.discount_type, i.discount_value ?? 0, shop.currency)}
                            {i.discount_ends_on ? ` until ${i.discount_ends_on}` : ""}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="font-semibold">
                            {i.price_cents === 0
                              ? "No price yet"
                              : formatMoney(i.price_cents, shop.currency)}
                          </p>
                          {upcoming && i.discount_type ? (
                            <p className="text-sm text-muted-foreground">
                              {discountLabel(i.discount_type, i.discount_value ?? 0, shop.currency)}{" "}
                              from {i.discount_starts_on}
                            </p>
                          ) : null}
                        </>
                      )}
                      {isOwner && costs.has(i.id) ? (
                        <p className="text-sm text-muted-foreground">
                          Cost {formatMoney(costs.get(i.id) ?? 0, shop.currency)}
                        </p>
                      ) : null}
                    </div>
                    {isOwner ? (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${i.name}`}
                          onClick={() => setEditing(i)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={i.archived_at ? `Restore ${i.name}` : `Archive ${i.name}`}
                          onClick={() => void setArchived(i, !i.archived_at)}
                        >
                          {i.archived_at ? <ArchiveRestore /> : <Archive />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${i.name}`}
                          onClick={() => void remove(i)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {isOwner && editing ? (
        <ItemDialog
          key={editing === "new" ? "new" : editing.id}
          shopId={shop.id}
          currency={shop.currency}
          item={editing === "new" ? null : editing}
          cost={editing === "new" ? undefined : costs.get(editing.id)}
          taxes={taxes}
          today={today}
          onClose={() => setEditing(null)}
          onSaved={async (name) => {
            setEditing(null);
            setMsg({ tone: "info", text: `${name} saved.` });
            await load();
          }}
        />
      ) : null}
    </>
  );
}

function ItemDialog({
  shopId,
  currency,
  item,
  cost,
  taxes,
  today,
  onClose,
  onSaved,
}: {
  shopId: string;
  currency: string;
  item: CatalogItem | null;
  cost: number | undefined;
  taxes: TaxRate[];
  today: string;
  onClose: () => void;
  onSaved: (name: string) => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: item?.name ?? "",
    category: item?.category ?? "",
    item_type: item?.item_type ?? "service",
    unit: item?.unit ?? "each",
    price: item ? centsToInput(item.price_cents) : "",
    sku: item?.sku ?? "",
    discount_type: (item?.discount_type ?? "") as DiscountType | "",
    discount_value: item?.discount_value?.toString() ?? "",
    starts: item?.discount_starts_on ?? "",
    ends: item?.discount_ends_on ?? "",
    // New items get every active rate ticked; most shops tax everything.
    taxIds: item ? item.tax_rate_ids : taxes.filter((t) => t.active).map((t) => t.id),
    cost: cost === undefined ? "" : centsToInput(cost),
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const expired = !!item?.discount_ends_on && item.discount_ends_on < today;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const price = parseMoney(form.price || "0");
    if (!form.name.trim()) return setError("Give the item a name.");
    if (price === null) return setError("Enter the price as a number, like 89.99.");
    let dValue: number | null = null;
    if (form.discount_type) {
      if (!/^\d+(\.\d{1,2})?$/.test(form.discount_value.trim()))
        return setError("Enter the discount as a number, like 10 or 15.50.");
      dValue = Number(form.discount_value);
      if (form.discount_type === "percent" && dValue > 100)
        return setError("A percent discount is 0 to 100.");
    }
    const costCents = form.cost.trim() ? parseMoney(form.cost) : null;
    if (form.cost.trim() && costCents === null) return setError("Enter the cost as a number.");
    setSaving(true);
    setError(null);
    const { error } = await getSupabase().rpc("save_catalog_item", {
      p_shop_id: shopId,
      p_item_id: item?.id ?? null,
      p_name: form.name,
      p_category: form.category,
      p_item_type: form.item_type,
      p_unit: form.unit,
      p_price_cents: price,
      p_sku: form.sku,
      p_discount_type: form.discount_type || null,
      p_discount_value: form.discount_type ? dValue : null,
      p_discount_starts_on: form.discount_type && form.starts ? form.starts : null,
      p_discount_ends_on: form.discount_type && form.ends ? form.ends : null,
      p_tax_rate_ids: form.taxIds,
      p_cost_cents: costCents,
    });
    setSaving(false);
    if (error) return setError(friendlyDbError(error));
    await onSaved(form.name.trim());
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto bg-background text-foreground sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">{item ? "Edit item" : "Add item"}</DialogTitle>
          <DialogDescription>
            Changes apply to new estimate lines only. Lines already on tickets keep their price.
          </DialogDescription>
        </DialogHeader>
        <form method="post" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field id="ci-name" label="Name">
              <Input
                id="ci-name"
                value={form.name}
                maxLength={120}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
          </div>
          <Field
            id="ci-price"
            label={form.unit === "hour" ? `Price per hour (${currency})` : `Price (${currency})`}
          >
            <Input
              id="ci-price"
              inputMode="decimal"
              value={form.price}
              placeholder="0.00"
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </Field>
          <Field id="ci-cost" label="Your cost (optional)" hint="Only you see this.">
            <Input
              id="ci-cost"
              inputMode="decimal"
              value={form.cost}
              placeholder="0.00"
              onChange={(e) => setForm({ ...form, cost: e.target.value })}
            />
          </Field>
          <Field id="ci-type" label="Type">
            <select
              id="ci-type"
              className={selectClass}
              value={form.item_type}
              onChange={(e) =>
                setForm({ ...form, item_type: e.target.value as CatalogItem["item_type"] })
              }
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="ci-unit" label="Sold by">
            <select
              id="ci-unit"
              className={selectClass}
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value as CatalogItem["unit"] })}
            >
              <option value="each">Each</option>
              <option value="hour">Hour</option>
            </select>
          </Field>
          <Field id="ci-cat" label="Category (optional)">
            <Input
              id="ci-cat"
              value={form.category}
              maxLength={60}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
          </Field>
          <Field id="ci-sku" label="SKU (optional)">
            <Input
              id="ci-sku"
              value={form.sku}
              maxLength={60}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
            />
          </Field>

          <fieldset className="flex flex-col gap-2 sm:col-span-2">
            <legend className="mb-1 text-sm font-medium">Taxes</legend>
            {taxes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No tax rates yet. Add them in Settings → Taxes.
              </p>
            ) : (
              taxes.map((t) => (
                <label key={t.id} className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={form.taxIds.includes(t.id)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        taxIds: e.target.checked
                          ? [...form.taxIds, t.id]
                          : form.taxIds.filter((x) => x !== t.id),
                      })
                    }
                  />
                  {t.name} ({t.rate}%){t.active ? "" : " · inactive"}
                </label>
              ))
            )}
          </fieldset>

          <fieldset className="grid gap-4 rounded-md border border-border p-4 sm:col-span-2 sm:grid-cols-2">
            <legend className="px-1 text-sm font-medium">Catalog discount (optional)</legend>
            {expired ? (
              <p className="text-sm text-muted-foreground sm:col-span-2">
                This discount ended on {item?.discount_ends_on}. Change the dates or remove it.
              </p>
            ) : null}
            <Field id="ci-dtype" label="Discount">
              <select
                id="ci-dtype"
                className={selectClass}
                value={form.discount_type}
                onChange={(e) =>
                  setForm({ ...form, discount_type: e.target.value as DiscountType | "" })
                }
              >
                <option value="">None</option>
                <option value="percent">Percent off</option>
                <option value="fixed">Amount off</option>
              </select>
            </Field>
            {form.discount_type ? (
              <>
                <Field
                  id="ci-dvalue"
                  label={form.discount_type === "percent" ? "Percent" : `Amount (${currency})`}
                  hint={form.discount_type === "fixed" ? "Comes off the whole line." : undefined}
                >
                  <Input
                    id="ci-dvalue"
                    inputMode="decimal"
                    value={form.discount_value}
                    onChange={(e) => setForm({ ...form, discount_value: e.target.value })}
                  />
                </Field>
                <Field id="ci-start" label="Starts (optional)">
                  <Input
                    id="ci-start"
                    type="date"
                    value={form.starts}
                    onChange={(e) => setForm({ ...form, starts: e.target.value })}
                  />
                </Field>
                <Field id="ci-end" label="Ends (optional)" hint="Includes this day, shop time.">
                  <Input
                    id="ci-end"
                    type="date"
                    value={form.ends}
                    onChange={(e) => setForm({ ...form, ends: e.target.value })}
                  />
                </Field>
              </>
            ) : null}
          </fieldset>

          {error ? (
            <div className="sm:col-span-2">
              <FormAlert tone="error">{error}</FormAlert>
            </div>
          ) : null}
          <div className="flex justify-end gap-3 sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save item"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
