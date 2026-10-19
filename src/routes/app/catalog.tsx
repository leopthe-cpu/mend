import { createFileRoute } from "@tanstack/react-router";
import { Archive, ArchiveRestore, Check, Plus, Tag, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/app/EmptyState";
import { FilterBar, ValueChip, type FilterOption } from "@/components/app/FilterBar";
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
import { MoneyInput } from "@/components/app/MaskedInputs";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { fetchMembers, shopToday, type Member } from "@/lib/tickets";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/catalog")({
  head: () => ({ meta: [{ title: "Catalog · Mend" }] }),
  component: CatalogPage,
});

const TYPES = [
  { value: "service", label: "Service" },
  { value: "part", label: "Part" },
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
  const isAdmin = roleAtLeast(membership.role, "admin");
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [taxes, setTaxes] = useState<TaxRate[]>([]);
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  // FilterBar ids: "flag:archived", "flag:sale", "type:<t>", "tax:<id>", "by:<user>".
  const [active, setActive] = useState<string[]>([]);
  const toggle = (id: string) =>
    setActive((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  const [editing, setEditing] = useState<CatalogItem | "new" | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const today = shopToday(shop.time_zone);

  const load = useCallback(async () => {
    try {
      const [c, t, m] = await Promise.all([
        fetchCatalog(shop.id),
        fetchTaxRates(shop.id),
        fetchMembers(shop.id),
      ]);
      setItems(c);
      setTaxes(t);
      setMembers(m);
    } catch (e) {
      setMsg({ tone: "error", text: friendlyDbError(e) });
    }
  }, [shop.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const memberName = useCallback(
    (id: string) => {
      const m = members.find((x) => x.user_id === id);
      return m ? m.name || m.email : "Former member";
    },
    [members],
  );

  const options = useMemo<FilterOption[]>(() => {
    const adders = [...new Set((items ?? []).map((i) => i.created_by).filter(Boolean))] as string[];
    return [
      { id: "flag:sale", group: "Show", label: "On sale now" },
      { id: "flag:archived", group: "Show", label: "Include archived" },
      ...TYPES.map((t) => ({ id: `type:${t.value}`, group: "Type", label: t.label })),
      ...taxes.map((t) => ({ id: `tax:${t.id}`, group: "Tax", label: t.name })),
      ...adders.map((id) => ({ id: `by:${id}`, group: "Added by", label: memberName(id) })),
    ];
  }, [items, taxes, memberName]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pick = (prefix: string) =>
      new Set(active.filter((a) => a.startsWith(prefix)).map((a) => a.slice(prefix.length)));
    const types = pick("type:");
    const tax = pick("tax:");
    const by = pick("by:");
    return (items ?? []).filter(
      (i) =>
        (active.includes("flag:archived") || !i.archived_at) &&
        (!active.includes("flag:sale") || (discountActiveOn(i, today) && !!i.discount_type)) &&
        (!types.size || types.has(i.item_type)) &&
        (!tax.size || i.tax_rate_ids.some((id) => tax.has(id))) &&
        (!by.size || (!!i.created_by && by.has(i.created_by))) &&
        (!q || i.name.toLowerCase().includes(q)),
    );
  }, [items, query, active, today]);

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
        text: error ? friendlyDbError(error) : "Only Admins can change the catalog.",
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
        text: error ? friendlyDbError(error) : "Only Admins can change the catalog.",
      });
    setMsg({ tone: "info", text: `${item.name} deleted.` });
    await load();
  }

  return (
    <>
      <PageHeader title="Catalog">
        {isAdmin ? (
          <Button variant="outline" onClick={() => setEditing("new")}>
            <Plus /> Catalog item
          </Button>
        ) : null}
      </PageHeader>
      <div className="flex flex-col gap-4">
        {!isAdmin ? (
          <FormAlert tone="info">
            Only Admins can change prices. You can use these items on estimates.
          </FormAlert>
        ) : null}
        {msg ? <FormAlert tone={msg.tone}>{msg.text}</FormAlert> : null}

        <FilterBar
          options={options}
          active={active}
          onToggle={toggle}
          text={query}
          onText={setQuery}
          placeholder="Search or filter: name, type, tax, on sale, added by…"
        />

        {items === null ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="rounded-lg bg-card p-6 text-muted-foreground">
            {items.length === 0
              ? isAdmin
                ? "No items yet. Add the services and parts you sell."
                : "No items yet. An Admin adds them."
              : "Nothing matches."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg bg-card">
            <table className="w-full text-left">
              <thead className="border-b border-border text-sm text-muted-foreground">
                <tr>
                  <th className="px-3 py-3 font-medium">Name</th>
                  <th className="px-3 py-3 font-medium">Type</th>
                  <th className="px-3 py-3 text-right font-medium">Price</th>
                  <th className="px-3 py-3 font-medium">Discount</th>
                  <th className="px-3 py-3 font-medium">Tax</th>
                  <th className="px-3 py-3 font-medium">Added by</th>
                  {isAdmin ? (
                    <th className="px-3 py-3 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((i) => {
                  // Expired discounts drop out of this view on their own (spec §7.6).
                  const onSale = discountActiveOn(i, today) && !!i.discount_type;
                  const type = TYPES.find((t) => t.value === i.item_type)?.label ?? "Service";
                  // The whole row opens the item (19 Oct feedback, item 11).
                  const open = () => (isAdmin ? setEditing(i) : undefined);
                  return (
                    <tr
                      key={i.id}
                      {...(isAdmin
                        ? {
                            role: "button",
                            tabIndex: 0,
                            "aria-label": `Edit ${i.name}`,
                            onClick: open,
                            onKeyDown: (e: React.KeyboardEvent) => {
                              if (e.target !== e.currentTarget) return;
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                open();
                              }
                            },
                          }
                        : {})}
                      className={cn(isAdmin && "cursor-pointer hover:bg-accent/40")}
                    >
                      <td className="px-3 py-3">
                        <span className="font-semibold">{i.name}</span>
                        {i.unit === "hour" ? (
                          <span className="ml-1.5 text-sm text-muted-foreground">per hour</span>
                        ) : null}
                        {i.archived_at ? (
                          <span className="ml-2 rounded-full bg-background px-2 py-0.5 text-sm text-muted-foreground">
                            Archived
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        <ValueChip
                          label={type}
                          pressed={active.includes(`type:${i.item_type}`)}
                          onClick={() => toggle(`type:${i.item_type}`)}
                        />
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">
                        {onSale ? (
                          <>
                            <span className="mr-2 text-sm text-muted-foreground line-through">
                              {formatMoney(i.price_cents, shop.currency)}
                            </span>
                            <span className="font-semibold">
                              {formatMoney(salePrice(i), shop.currency)}
                            </span>
                          </>
                        ) : i.price_cents === 0 ? (
                          <span className="text-muted-foreground">No price yet</span>
                        ) : (
                          formatMoney(i.price_cents, shop.currency)
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <DiscountCell
                          item={i}
                          today={today}
                          currency={shop.currency}
                          canEdit={isAdmin}
                          onSaved={async (text) => {
                            setMsg({ tone: "info", text });
                            await load();
                          }}
                          onError={(text) => setMsg({ tone: "error", text })}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <span className="flex flex-wrap gap-1">
                          {taxes
                            .filter((t) => i.tax_rate_ids.includes(t.id))
                            .map((t) => (
                              <ValueChip
                                key={t.id}
                                label={t.name}
                                pressed={active.includes(`tax:${t.id}`)}
                                onClick={() => toggle(`tax:${t.id}`)}
                              />
                            ))}
                          {i.tax_rate_ids.length ? null : (
                            <span className="text-muted-foreground">No tax</span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {i.created_by ? (
                          <ValueChip
                            label={memberName(i.created_by)}
                            pressed={active.includes(`by:${i.created_by}`)}
                            onClick={() => toggle(`by:${i.created_by}`)}
                          />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      {isAdmin ? (
                        <td className="px-2 py-2">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={i.archived_at ? `Restore ${i.name}` : `Archive ${i.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                void setArchived(i, !i.archived_at);
                              }}
                            >
                              {i.archived_at ? <ArchiveRestore /> : <Archive />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Delete ${i.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                void remove(i);
                              }}
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isAdmin && editing ? (
        <ItemDialog
          key={editing === "new" ? "new" : editing.id}
          shopId={shop.id}
          currency={shop.currency}
          item={editing === "new" ? null : editing}
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
  taxes,
  today,
  onClose,
  onSaved,
}: {
  shopId: string;
  currency: string;
  item: CatalogItem | null;
  taxes: TaxRate[];
  today: string;
  onClose: () => void;
  onSaved: (name: string) => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: item?.name ?? "",
    item_type: (item?.item_type ?? "service") as "service" | "part",
    price: item ? centsToInput(item.price_cents) : "",
  });
  const [allTaxes, setAllTaxes] = useState<TaxRate[]>(taxes);
  const [taxIds, setTaxIds] = useState<string[]>(item ? item.tax_rate_ids : []);
  const [showTax, setShowTax] = useState(item ? item.tax_rate_ids.length > 0 : false);
  const [showDiscount, setShowDiscount] = useState(!!item?.discount_type);
  const [discount, setDiscount] = useState({
    discount_type: (item?.discount_type ?? "") as DiscountType | "",
    discount_value: item?.discount_value?.toString() ?? "",
    starts: item?.discount_starts_on ?? "",
    ends: item?.discount_ends_on ?? "",
  });
  const [newTaxName, setNewTaxName] = useState("");
  const [newTaxRate, setNewTaxRate] = useState("");
  const [pickTaxId, setPickTaxId] = useState("");
  const [errors, setErrors] = useState<{
    name?: string | undefined;
    price?: string | undefined;
    tax?: string | undefined;
    discount?: string | undefined;
  }>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [creatingTax, setCreatingTax] = useState(false);

  const expired = !!item?.discount_ends_on && item.discount_ends_on < today;
  const perHour = item?.unit === "hour";
  const RATE_RE = /^\d{1,2}(\.\d{1,3})?$|^100(\.0{1,3})?$/;

  function focus(id: string) {
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  }

  async function confirmNewTax() {
    const name = newTaxName.trim();
    const rate = newTaxRate.trim();
    if (!name) {
      setErrors((e) => ({ ...e, tax: "Name the tax, e.g. HST." }));
      focus("ci-tax-name");
      return;
    }
    if (!RATE_RE.test(rate)) {
      setErrors((e) => ({ ...e, tax: "Enter the rate in percent, e.g. 13." }));
      focus("ci-tax-rate");
      return;
    }
    setCreatingTax(true);
    setErrors((e) => ({ ...e, tax: undefined }));
    const { data, error } = await getSupabase()
      .from("tax_rates")
      .insert({ shop_id: shopId, name, rate: Number(rate) })
      .select("id, name, rate, active")
      .single();
    setCreatingTax(false);
    if (error || !data) {
      setErrors({
        ...errors,
        tax: error ? friendlyDbError(error) : "Only Admins can add taxes.",
      });
      return;
    }
    const created = data as TaxRate;
    setAllTaxes((t) => [...t, created]);
    setTaxIds((ids) => [...ids, created.id]);
    setNewTaxName("");
    setNewTaxRate("");
  }

  function addExistingTax() {
    if (!pickTaxId) return;
    setTaxIds((ids) => (ids.includes(pickTaxId) ? ids : [...ids, pickTaxId]));
    setPickTaxId("");
    setErrors((e) => ({ ...e, tax: undefined }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setError(null);
    if (!form.name.trim()) {
      setErrors({ name: "Give the item a name." });
      focus("ci-name");
      return;
    }
    if (!form.price.trim()) {
      setErrors({ price: "Enter a price." });
      focus("ci-price");
      return;
    }
    const price = parseMoney(form.price);
    if (price === null) {
      setErrors({ price: "Enter the price as a number, like 89.99." });
      focus("ci-price");
      return;
    }
    // An inline value that hasn't been confirmed with ✓ counts as unfinished.
    if (newTaxName.trim() || newTaxRate.trim()) {
      setErrors({ tax: "Confirm the new tax with ✓, or clear it." });
      focus("ci-tax-name");
      return;
    }
    let dValue: number | null = null;
    if (showDiscount && discount.discount_type) {
      if (!/^\d+(\.\d{1,2})?$/.test(discount.discount_value.trim())) {
        setErrors({ discount: "Enter the discount as a number, like 10 or 15.50." });
        focus("ci-dvalue");
        return;
      }
      dValue = Number(discount.discount_value);
      if (discount.discount_type === "percent" && dValue > 100) {
        setErrors({ discount: "A percent discount is 0 to 100." });
        focus("ci-dvalue");
        return;
      }
    }
    setSaving(true);
    const { error } = await getSupabase().rpc("save_catalog_item", {
      p_shop_id: shopId,
      p_item_id: item?.id ?? null,
      p_name: form.name,
      p_category: item?.category ?? "",
      p_item_type: form.item_type,
      p_unit: item?.unit ?? "each",
      p_price_cents: price,
      p_sku: item?.sku ?? "",
      p_discount_type: showDiscount && discount.discount_type ? discount.discount_type : null,
      p_discount_value: showDiscount && discount.discount_type ? dValue : null,
      p_discount_starts_on:
        showDiscount && discount.discount_type && discount.starts ? discount.starts : null,
      p_discount_ends_on:
        showDiscount && discount.discount_type && discount.ends ? discount.ends : null,
      p_tax_rate_ids: taxIds,
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
            <Field id="ci-name" label="Name *">
              <Input
                id="ci-name"
                value={form.name}
                maxLength={120}
                onChange={(e) => {
                  setForm({ ...form, name: e.target.value });
                  setErrors((err) => ({ ...err, name: undefined }));
                }}
              />
              {errors.name ? <p className="text-sm text-danger">{errors.name}</p> : null}
            </Field>
          </div>
          <Field id="ci-price" label={`${perHour ? "Price per hour" : "Price"} (${currency}) *`}>
            <MoneyInput
              id="ci-price"
              value={form.price}
              onValueChange={(price) => {
                setForm({ ...form, price });
                setErrors((err) => ({ ...err, price: undefined }));
              }}
            />
            {errors.price ? <p className="text-sm text-danger">{errors.price}</p> : null}
          </Field>
          <Field id="ci-type" label="Type">
            <select
              id="ci-type"
              className={selectClass}
              value={form.item_type}
              onChange={(e) =>
                setForm({ ...form, item_type: e.target.value as "service" | "part" })
              }
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>

          {!showDiscount ? (
            <div className="sm:col-span-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDiscount((d) => ({ ...d, discount_type: d.discount_type || "percent" }));
                  setShowDiscount(true);
                }}
              >
                <Plus /> Add discount
              </Button>
            </div>
          ) : (
            <fieldset className="grid gap-4 rounded-md border border-border p-4 sm:col-span-2 sm:grid-cols-2">
              <legend className="px-1 text-sm font-medium">Discount</legend>
              {expired ? (
                <p className="text-sm text-muted-foreground sm:col-span-2">
                  This discount ended on {item?.discount_ends_on}. Change the dates or remove it.
                </p>
              ) : null}
              <Field id="ci-dtype" label="Discount">
                <select
                  id="ci-dtype"
                  className={selectClass}
                  value={discount.discount_type}
                  onChange={(e) =>
                    setDiscount({
                      ...discount,
                      discount_type: e.target.value as DiscountType | "",
                      discount_value: "",
                    })
                  }
                >
                  <option value="percent">Percent off</option>
                  <option value="fixed">Amount off</option>
                </select>
              </Field>
              <Field
                id="ci-dvalue"
                label={discount.discount_type === "percent" ? "Percent" : `Amount (${currency})`}
                hint={discount.discount_type === "fixed" ? "Comes off the whole line." : undefined}
              >
                {discount.discount_type === "fixed" ? (
                  <MoneyInput
                    id="ci-dvalue"
                    value={discount.discount_value}
                    onValueChange={(discount_value) => {
                      setDiscount({ ...discount, discount_value });
                      setErrors((err) => ({ ...err, discount: undefined }));
                    }}
                  />
                ) : (
                  <Input
                    id="ci-dvalue"
                    inputMode="decimal"
                    value={discount.discount_value}
                    onChange={(e) => {
                      setDiscount({ ...discount, discount_value: e.target.value });
                      setErrors((err) => ({ ...err, discount: undefined }));
                    }}
                  />
                )}
              </Field>
              <Field id="ci-start" label="Starts (optional)">
                <Input
                  id="ci-start"
                  type="date"
                  value={discount.starts}
                  onChange={(e) => setDiscount({ ...discount, starts: e.target.value })}
                />
              </Field>
              <Field id="ci-end" label="Ends (optional)" hint="Includes this day, shop time.">
                <Input
                  id="ci-end"
                  type="date"
                  value={discount.ends}
                  onChange={(e) => setDiscount({ ...discount, ends: e.target.value })}
                />
              </Field>
              {errors.discount ? (
                <p className="text-sm text-danger sm:col-span-2">{errors.discount}</p>
              ) : null}
              <div className="flex justify-end sm:col-span-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowDiscount(false);
                    setDiscount({
                      discount_type: "",
                      discount_value: "",
                      starts: "",
                      ends: "",
                    });
                    setErrors((err) => ({ ...err, discount: undefined }));
                  }}
                >
                  <X /> Remove discount
                </Button>
              </div>
            </fieldset>
          )}

          {!showTax ? (
            <div className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setShowTax(true)}>
                <Plus /> Add tax
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-md border border-border p-4 sm:col-span-2">
              <div className="flex flex-wrap items-center gap-2">
                {allTaxes
                  .filter((t) => taxIds.includes(t.id))
                  .map((t) => (
                    <span
                      key={t.id}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-3 py-1 text-sm"
                    >
                      {t.name} ({t.rate}%)
                      <button
                        type="button"
                        aria-label={`Remove ${t.name}`}
                        className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                        onClick={() => setTaxIds((ids) => ids.filter((id) => id !== t.id))}
                      >
                        <X className="size-4" />
                      </button>
                    </span>
                  ))}
                {taxIds.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tax on this item yet.</p>
                ) : null}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Field id="ci-pick-tax" label="Existing tax">
                    <select
                      id="ci-pick-tax"
                      className={selectClass}
                      value={pickTaxId}
                      onChange={(e) => setPickTaxId(e.target.value)}
                    >
                      <option value="">Choose a tax…</option>
                      {allTaxes
                        .filter((t) => !taxIds.includes(t.id))
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.rate}%){t.active ? "" : " · inactive"}
                          </option>
                        ))}
                    </select>
                  </Field>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Add the chosen tax"
                  disabled={!pickTaxId}
                  onClick={addExistingTax}
                >
                  <Check />
                </Button>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Field id="ci-tax-name" label="New tax name">
                    <Input
                      id="ci-tax-name"
                      value={newTaxName}
                      maxLength={40}
                      placeholder="HST"
                      onChange={(e) => {
                        setNewTaxName(e.target.value);
                        setErrors((err) => ({ ...err, tax: undefined }));
                      }}
                    />
                  </Field>
                </div>
                <div className="sm:w-32">
                  <Field id="ci-tax-rate" label="Rate (%)">
                    <Input
                      id="ci-tax-rate"
                      inputMode="decimal"
                      value={newTaxRate}
                      placeholder="13"
                      onChange={(e) => {
                        setNewTaxRate(e.target.value);
                        setErrors((err) => ({ ...err, tax: undefined }));
                      }}
                    />
                  </Field>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Confirm new tax"
                  disabled={creatingTax}
                  onClick={() => void confirmNewTax()}
                >
                  <Check />
                </Button>
              </div>
              {errors.tax ? <p className="text-sm text-danger">{errors.tax}</p> : null}
            </div>
          )}

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

/**
 * The discount, set or removed right from the row (19 Oct feedback, item 11).
 * Start/end dates are kept as they are; the item dialog edits them.
 */
function DiscountCell({
  item,
  today,
  currency,
  canEdit,
  onSaved,
  onError,
}: {
  item: CatalogItem;
  today: string;
  currency: string;
  canEdit: boolean;
  onSaved: (text: string) => Promise<void>;
  onError: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<DiscountType>(item.discount_type ?? "percent");
  const [value, setValue] = useState(item.discount_value ? String(item.discount_value) : "");
  const [saving, setSaving] = useState(false);
  const active = discountActiveOn(item, today) && !!item.discount_type;
  const upcoming =
    !!item.discount_type && !!item.discount_starts_on && item.discount_starts_on > today;
  const label = item.discount_type
    ? discountLabel(item.discount_type, item.discount_value ?? 0, currency) +
      (upcoming
        ? ` from ${item.discount_starts_on}`
        : item.discount_ends_on && active
          ? ` until ${item.discount_ends_on}`
          : "")
    : null;

  async function save(remove: boolean) {
    const n = Number(value.replace(",", "."));
    if (!remove && (!Number.isFinite(n) || n <= 0 || (type === "percent" && n > 100)))
      return onError(
        type === "percent" ? "Enter a percent from 1 to 100." : "Enter an amount above 0.",
      );
    setSaving(true);
    const { data, error } = await getSupabase()
      .from("catalog_items")
      .update(
        remove
          ? {
              discount_type: null,
              discount_value: null,
              discount_starts_on: null,
              discount_ends_on: null,
            }
          : { discount_type: type, discount_value: Math.round(n * 100) / 100 },
      )
      .eq("id", item.id)
      .select("id");
    setSaving(false);
    if (error || !data?.length)
      return onError(error ? friendlyDbError(error) : "Only Admins can change the catalog.");
    setOpen(false);
    await onSaved(remove ? `Discount removed from ${item.name}.` : `${item.name} discount saved.`);
  }

  const chip = label ? (
    <span
      className={cn(
        "inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 text-sm font-medium",
        active ? "bg-success/15" : "bg-background text-muted-foreground",
      )}
    >
      <Tag aria-hidden className="size-3.5" />
      {label}
    </span>
  ) : null;
  if (!canEdit) return chip ?? <span className="text-muted-foreground">—</span>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label ? `Change discount (${label})` : `Add a discount to ${item.name}`}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className="cursor-pointer rounded-full"
        >
          {chip ?? (
            <span className="inline-flex min-h-8 items-center gap-1 rounded-full border border-dashed border-border px-2.5 text-sm text-muted-foreground hover:text-foreground">
              <Plus aria-hidden className="size-3.5" /> Discount
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 rounded-lg"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
        >
          <p className="font-semibold">Discount on {item.name}</p>
          <div className="flex gap-2">
            <div
              role="radiogroup"
              aria-label="Kind"
              className="flex rounded-full bg-background p-1"
            >
              {(["percent", "fixed"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={type === k}
                  onClick={() => setType(k)}
                  className={cn(
                    "h-8 cursor-pointer rounded-full px-3 text-sm font-medium",
                    type === k ? "bg-foreground text-background" : "",
                  )}
                >
                  {k === "percent" ? "%" : "$"}
                </button>
              ))}
            </div>
            <Input
              aria-label={type === "percent" ? "Percent off" : "Amount off"}
              inputMode="decimal"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={type === "percent" ? "10" : "5.00"}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              <Check aria-hidden /> Save
            </Button>
            {item.discount_type ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => void save(true)}
              >
                <X aria-hidden /> Remove
              </Button>
            ) : null}
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
