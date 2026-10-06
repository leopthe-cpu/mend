import {
  Check,
  Download,
  FilePlus2,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Field, Panel, selectClass } from "@/components/app/Field";
import { FormAlert } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  APPROVAL_LABEL,
  type ApprovalMethod,
  balance,
  type Estimate,
  fetchMoney,
  KIND_LABEL,
  type Line,
  lineDiscountText,
  METHOD_LABEL,
  type MoneyData,
  type Payment,
  type PaymentKind,
  type PaymentMethod,
  quantityText,
  STATUS_LABEL,
} from "@/lib/estimates";
import {
  type CatalogItem,
  centsToInput,
  discountActiveOn,
  fetchCatalog,
  fetchTaxRates,
  formatMoney,
  parseMoney,
  parseQuantity,
  type TaxRate,
} from "@/lib/money";
import { logoUrl } from "@/lib/logo";
import { friendlyDbError, roleAtLeast, type Membership } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import { shopToday, type Ticket } from "@/lib/tickets";
import { cn } from "@/lib/utils";

type Msg = { tone: "error" | "info"; text: string } | null;

const APPROVAL_OPTION: Record<ApprovalMethod, string> = {
  in_person: "In person",
  phone: "By phone",
  text_reply: "By text reply",
  email_reply: "By email reply",
  other: "Another way",
};
type Rpc = (name: string, args: Record<string, unknown>, ok?: string) => Promise<boolean>;

const STATUS_CLASS: Record<Estimate["status"], string> = {
  draft: "border-border text-muted-foreground",
  sent: "border-status-in-progress text-foreground",
  approved: "border-status-ready text-foreground",
  declined: "border-danger text-danger",
  superseded: "border-border text-muted-foreground",
};

export function MoneySection({
  ticket,
  membership,
  customerName,
  onChanged,
}: {
  ticket: Ticket;
  membership: Membership;
  customerName: string;
  onChanged: () => void;
}) {
  const shop = membership.shop;
  const isAdmin = roleAtLeast(membership.role, "admin");
  const money = useCallback((c: number) => formatMoney(c, shop.currency), [shop.currency]);
  const [data, setData] = useState<MoneyData | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [taxes, setTaxes] = useState<TaxRate[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, c, t] = await Promise.all([
        fetchMoney(ticket.id),
        fetchCatalog(shop.id),
        fetchTaxRates(shop.id),
      ]);
      setData(d);
      setCatalog(c.filter((i) => !i.archived_at));
      setTaxes(t);
    } catch (e) {
      setMsg({ tone: "error", text: friendlyDbError(e) });
    }
  }, [ticket.id, shop.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const rpc: Rpc = useCallback(
    async (name, args, ok) => {
      setBusy(true);
      setMsg(null);
      try {
        const { error } = await getSupabase().rpc(name, args);
        if (error) {
          setMsg({ tone: "error", text: friendlyDbError(error) });
          return false;
        }
        // Reload before confirming, so the message never sits next to stale totals.
        await load();
        if (ok) setMsg({ tone: "info", text: ok });
        onChanged();
        return true;
      } finally {
        setBusy(false);
      }
    },
    [load, onChanged],
  );

  const current = data?.estimates.find((e) => e.status !== "superseded") ?? null;
  const shown =
    data?.estimates.find((e) => e.id === selected) ?? current ?? data?.estimates[0] ?? null;
  const lines = useMemo(
    () => (data && shown ? data.lines.filter((l) => l.estimate_id === shown.id) : []),
    [data, shown],
  );
  const invoiceFor = (id: string) => data?.invoices.find((i) => i.estimate_id === id);

  async function pdfFor(kind: "estimate" | "invoice", est: Estimate) {
    if (!data) return;
    setBusy(true);
    try {
      const { downloadPdf } = await import("@/lib/pdf");
      // The current logo (also on older invoices): a missing or broken logo
      // just leaves it off rather than failing the PDF.
      const logo = await logoUrl(shop.logo_path).catch(() => null);
      const invoice = kind === "invoice" ? invoiceFor(est.id) : undefined;
      await downloadPdf({
        kind,
        shop: invoice?.shop_snapshot
          ? { ...invoice.shop_snapshot, currency: invoice.shop_snapshot.currency ?? shop.currency }
          : {
              name: shop.name,
              address: shop.address,
              phone: shop.phone,
              email: shop.email,
              tax_registration_number: shop.tax_registration_number,
              currency: shop.currency,
              terms_text: shop.terms_text,
            },
        logoUrl: logo,
        timeZone: shop.time_zone,
        ticketNumber: ticket.ticket_number,
        itemName: ticket.item_name,
        customerName,
        estimate: est,
        lines: data.lines.filter((l) => l.estimate_id === est.id),
        ...(invoice ? { invoice, payments: data.payments } : {}),
      });
    } catch {
      setMsg({ tone: "error", text: "Couldn't make the PDF. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <Panel title="Estimate">
        {msg ? (
          <FormAlert tone={msg.tone}>{msg.text}</FormAlert>
        ) : (
          <p className="text-muted-foreground">Loading…</p>
        )}
      </Panel>
    );
  }

  const editable = shown?.status === "draft" && shown.id === current?.id;
  const bal = balance(data);

  return (
    <>
      <Panel title="Estimate">
        <div className="flex flex-col gap-4">
          {msg ? <FormAlert tone={msg.tone}>{msg.text}</FormAlert> : null}

          {!shown ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-muted-foreground">No estimate yet.</p>
              <Button
                disabled={busy}
                onClick={() => void rpc("start_estimate", { p_ticket_id: ticket.id })}
              >
                <FilePlus2 /> Start estimate
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                {data.estimates.length > 1 ? (
                  <select
                    aria-label="Estimate version"
                    className={cn(selectClass, "w-auto")}
                    value={shown.id}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    {data.estimates.map((e) => (
                      <option key={e.id} value={e.id}>
                        Version {e.version} · {STATUS_LABEL[e.status]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="font-medium">Version {shown.version}</span>
                )}
                <span
                  className={cn(
                    "rounded border px-2 py-0.5 text-sm font-medium",
                    STATUS_CLASS[shown.status],
                  )}
                >
                  {STATUS_LABEL[shown.status]}
                </span>
                {shown.approved_at && shown.approval_method ? (
                  <span className="text-sm text-muted-foreground">
                    Approved {APPROVAL_LABEL[shown.approval_method]} on{" "}
                    {shopToday(shop.time_zone, new Date(shown.approved_at))}
                  </span>
                ) : null}
              </div>

              {lines.length === 0 ? (
                <p className="text-muted-foreground">No lines yet. Add items from the catalog.</p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {lines.map((l) => (
                    <LineRow
                      key={l.id}
                      line={l}
                      editable={editable}
                      isAdmin={isAdmin}
                      busy={busy}
                      money={money}
                      rpc={rpc}
                    />
                  ))}
                </ul>
              )}

              {editable ? (
                <AddLine
                  estimateId={shown.id}
                  catalog={catalog}
                  taxes={taxes}
                  today={shopToday(shop.time_zone)}
                  isAdmin={isAdmin}
                  busy={busy}
                  money={money}
                  rpc={rpc}
                />
              ) : null}

              <Totals est={shown} money={money} />

              <EstimateActions
                est={shown}
                isCurrent={shown.id === current?.id}
                hasLines={lines.length > 0}
                invoiceNumber={invoiceFor(shown.id)?.invoice_number}
                busy={busy}
                rpc={rpc}
                onPdf={(kind) => void pdfFor(kind, shown)}
              />
            </>
          )}

          {data.invoices.length ? (
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <h3 className="font-semibold">Invoices</h3>
              <ul className="flex flex-col gap-2">
                {data.invoices.map((inv) => {
                  const est = data.estimates.find((e) => e.id === inv.estimate_id);
                  return (
                    <li key={inv.id} className="flex flex-wrap items-center gap-3">
                      <span
                        className={cn(
                          "font-medium",
                          inv.voided_at && "text-muted-foreground line-through",
                        )}
                      >
                        Invoice #{inv.invoice_number}
                      </span>
                      <span className="text-muted-foreground">
                        {money(inv.total_cents)} ·{" "}
                        {shopToday(shop.time_zone, new Date(inv.issued_at))}
                        {inv.voided_at ? " · replaced by a newer invoice" : ""}
                      </span>
                      {est ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void pdfFor("invoice", est)}
                        >
                          <Download /> PDF
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel title="Payments">
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-3 gap-3 rounded-md border border-border p-4 text-center">
            <div>
              <dt className="text-sm text-muted-foreground">
                {bal.basis === "invoice" ? "Invoice total" : "Estimate total"}
              </dt>
              <dd className="text-lg font-semibold">{money(bal.due)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Paid</dt>
              <dd className="text-lg font-semibold">{money(bal.paid)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Balance due</dt>
              <dd className={cn("text-lg font-semibold", bal.balance < 0 && "text-warning")}>
                {money(bal.balance)}
              </dd>
            </div>
          </dl>
          {bal.balance < 0 ? (
            <p className="text-sm text-warning">The customer has paid more than the total.</p>
          ) : null}

          {data.payments.length ? (
            <ul className="divide-y divide-border rounded-md border border-border">
              {data.payments.map((p) => (
                <PaymentRow
                  key={p.id}
                  payment={p}
                  isAdmin={isAdmin}
                  busy={busy}
                  money={money}
                  rpc={rpc}
                />
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No payments recorded.</p>
          )}

          <PaymentForm
            // Re-prefill the amount whenever the balance changes.
            key={`new-${bal.balance}-${bal.basis}`}
            submitLabel="Record payment"
            initial={{
              kind: data.payments.length || bal.basis === "invoice" ? "payment" : "deposit",
              method: "card",
              amount: bal.balance > 0 ? centsToInput(bal.balance) : "",
              paid_on: shopToday(shop.time_zone),
              note: "",
            }}
            busy={busy}
            onSubmit={(v) =>
              rpc(
                "record_payment",
                {
                  p_ticket_id: ticket.id,
                  p_kind: v.kind,
                  p_method: v.method,
                  p_amount_cents: v.amount_cents,
                  p_paid_on: v.paid_on,
                  p_note: v.note,
                },
                "Payment recorded.",
              )
            }
          />
          <p className="text-sm text-muted-foreground">
            Mend records payments only. Never enter card numbers here.
          </p>
        </div>
      </Panel>
    </>
  );
}

function LineRow({
  line: l,
  editable,
  isAdmin,
  busy,
  money,
  rpc,
}: {
  line: Line;
  editable: boolean;
  isAdmin: boolean;
  busy: boolean;
  money: (c: number) => string;
  rpc: Rpc;
}) {
  const [qty, setQty] = useState(String(l.quantity));
  const [editPrice, setEditPrice] = useState(false);
  const [price, setPrice] = useState(centsToInput(l.unit_price_cents));
  const [editDiscount, setEditDiscount] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const override =
    l.catalog_unit_price_cents !== null && l.catalog_unit_price_cents !== l.unit_price_cents;
  const dText = lineDiscountText(l, money);

  function commitQty() {
    const q = parseQuantity(qty);
    if (q === null) {
      setErr("Quantity must be a number above 0, like 1 or 1.5.");
      return setQty(String(l.quantity));
    }
    setErr(null);
    if (q !== l.quantity) void rpc("update_estimate_line", { p_line_id: l.id, p_quantity: q });
  }

  return (
    <li className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-40 flex-1">
          <p className="font-medium">
            {l.name_snapshot}
            {l.is_custom ? (
              <span className="ml-2 rounded border border-border px-1.5 text-sm font-normal text-muted-foreground">
                Custom
              </span>
            ) : null}
          </p>
          <p className="text-sm text-muted-foreground">
            {override ? (
              <>
                <s>{money(l.catalog_unit_price_cents ?? 0)}</s>{" "}
              </>
            ) : null}
            {money(l.unit_price_cents)}
            {l.unit_snapshot === "hour" ? " / hour" : " each"}
            {l.tax_snapshot.length
              ? ` · ${l.tax_snapshot.map((t) => t.name).join(", ")}`
              : " · no tax"}
          </p>
        </div>
        {editable ? (
          <Input
            aria-label={`Quantity of ${l.name_snapshot}`}
            className="w-20"
            inputMode="decimal"
            value={qty}
            disabled={busy}
            onChange={(e) => setQty(e.target.value)}
            onBlur={commitQty}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitQty();
              }
            }}
          />
        ) : (
          <span className="w-20 text-right">× {quantityText(l)}</span>
        )}
        <div className="w-28 text-right">
          {l.discount_cents > 0 ? (
            <p className="text-sm text-muted-foreground line-through">
              {money(l.line_subtotal_cents)}
            </p>
          ) : null}
          <p className="font-semibold">{money(l.line_total_cents)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* One discount control per line; Staff see it read-only (spec §7.8). */}
        {editable && isAdmin ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={editDiscount}
            onClick={() => setEditDiscount(!editDiscount)}
          >
            <Tag /> {dText ?? "Discount"}
          </Button>
        ) : dText ? (
          <span className="inline-flex items-center gap-1 text-sm text-success">
            <Tag className="size-4" aria-hidden /> {dText}
          </span>
        ) : null}
        {dText && l.discount_reason ? (
          <span className="text-sm text-muted-foreground">{l.discount_reason}</span>
        ) : null}
        {dText && l.discount_source === "catalog" ? (
          <span className="text-sm text-muted-foreground">catalog sale</span>
        ) : null}
        {editable && isAdmin ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditPrice(!editPrice)}>
            <Pencil /> Price
          </Button>
        ) : null}
        {editable ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void rpc("remove_estimate_line", { p_line_id: l.id })}
          >
            <Trash2 /> Remove
          </Button>
        ) : null}
      </div>

      {editPrice ? (
        <form
          method="post"
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const cents = parseMoney(price);
            if (cents === null) return setErr("Enter the price as a number, like 150.");
            setErr(null);
            void rpc(
              "update_estimate_line",
              { p_line_id: l.id, p_unit_price_cents: cents },
              "Price changed. This is recorded in the audit log.",
            ).then((ok) => ok && setEditPrice(false));
          }}
        >
          <Field id={`lp-${l.id}`} label="Unit price">
            <Input
              id={`lp-${l.id}`}
              className="w-32"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={busy}>
            <Check /> Save price
          </Button>
          {override && l.catalog_unit_price_cents !== null ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void rpc("update_estimate_line", {
                  p_line_id: l.id,
                  p_unit_price_cents: l.catalog_unit_price_cents,
                }).then((ok) => ok && setEditPrice(false))
              }
            >
              <RotateCcw /> Catalog price
            </Button>
          ) : null}
        </form>
      ) : null}

      {editDiscount ? (
        <DiscountEditor line={l} busy={busy} rpc={rpc} onDone={() => setEditDiscount(false)} />
      ) : null}
      {err ? <p className="text-sm text-danger">{err}</p> : null}
    </li>
  );
}

function DiscountEditor({
  line: l,
  busy,
  rpc,
  onDone,
}: {
  line: Line;
  busy: boolean;
  rpc: Rpc;
  onDone: () => void;
}) {
  const [type, setType] = useState<"" | "percent" | "fixed">(l.discount_type ?? "");
  const [value, setValue] = useState(l.discount_value === null ? "" : String(l.discount_value));
  const [reason, setReason] = useState(l.discount_reason ?? "");
  const [err, setErr] = useState<string | null>(null);

  return (
    <form
      method="post"
      className="grid gap-3 rounded-md border border-border bg-card p-3 sm:grid-cols-[10rem_8rem_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (type && !/^\d+(\.\d{1,2})?$/.test(value.trim()))
          return setErr("Enter a number, like 10 or 15.50.");
        if (type === "percent" && Number(value) > 100) return setErr("A percent is 0 to 100.");
        setErr(null);
        void rpc(
          "set_line_discount",
          {
            p_line_id: l.id,
            p_type: type || null,
            p_value: type ? Number(value) : null,
            p_reason: type ? reason : null,
          },
          type ? "Discount saved." : "Discount removed.",
        ).then((ok) => ok && onDone());
      }}
    >
      <Field id={`dt-${l.id}`} label="Discount">
        <select
          id={`dt-${l.id}`}
          className={selectClass}
          value={type}
          onChange={(e) => setType(e.target.value as "" | "percent" | "fixed")}
        >
          <option value="">None</option>
          <option value="percent">Percent off</option>
          <option value="fixed">Amount off</option>
        </select>
      </Field>
      {type ? (
        <>
          <Field id={`dv-${l.id}`} label={type === "percent" ? "Percent" : "Amount"}>
            <Input
              id={`dv-${l.id}`}
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
          <Field id={`dr-${l.id}`} label="Reason (optional)">
            <Input
              id={`dr-${l.id}`}
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        </>
      ) : (
        <div className="sm:col-span-2" />
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          <Check /> Save
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label="Cancel" onClick={onDone}>
          <X />
        </Button>
      </div>
      {err ? <p className="text-sm text-danger sm:col-span-4">{err}</p> : null}
      {type === "fixed" ? (
        <p className="text-sm text-muted-foreground sm:col-span-4">
          An amount comes off the whole line, not each unit.
        </p>
      ) : null}
    </form>
  );
}

function AddLine({
  estimateId,
  catalog,
  taxes,
  today,
  isAdmin,
  busy,
  money,
  rpc,
}: {
  estimateId: string;
  catalog: CatalogItem[];
  taxes: TaxRate[];
  today: string;
  isAdmin: boolean;
  busy: boolean;
  money: (c: number) => string;
  rpc: Rpc;
}) {
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [custom, setCustom] = useState(false);
  const [c, setC] = useState({
    name: "",
    qty: "1",
    price: "",
    taxIds: taxes.filter((t) => t.active).map((t) => t.id),
  });
  const [err, setErr] = useState<string | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, CatalogItem[]>();
    for (const i of catalog)
      m.set(i.category ?? "Other", [...(m.get(i.category ?? "Other") ?? []), i]);
    return [...m.entries()];
  }, [catalog]);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed border-border p-3">
      <form
        method="post"
        className="grid gap-3 sm:grid-cols-[1fr_6rem_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          const q = parseQuantity(qty);
          if (!itemId) return setErr("Pick an item.");
          if (q === null) return setErr("Quantity must be a number above 0.");
          setErr(null);
          void rpc("add_estimate_line", {
            p_estimate_id: estimateId,
            p_catalog_item_id: itemId,
            p_quantity: q,
          }).then((ok) => {
            if (ok) {
              setItemId("");
              setQty("1");
            }
          });
        }}
      >
        <Field id={`add-${estimateId}`} label="Add from catalog">
          <select
            id={`add-${estimateId}`}
            className={selectClass}
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
          >
            <option value="">{catalog.length ? "Choose an item…" : "The catalog is empty"}</option>
            {groups.map(([group, items]) => (
              <optgroup key={group} label={group}>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} · {money(i.price_cents)}
                    {i.unit === "hour" ? "/h" : ""}
                    {discountActiveOn(i, today) ? " · on sale" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field id={`addq-${estimateId}`} label="Qty">
          <Input
            id={`addq-${estimateId}`}
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </Field>
        <Button type="submit" disabled={busy}>
          <Plus /> Add
        </Button>
      </form>

      {isAdmin ? (
        custom ? (
          <form
            method="post"
            className="grid gap-3 border-t border-border pt-3 sm:grid-cols-[1fr_6rem_8rem]"
            onSubmit={(e) => {
              e.preventDefault();
              const q = parseQuantity(c.qty);
              const p = parseMoney(c.price);
              if (!c.name.trim()) return setErr("Name the custom line.");
              if (q === null) return setErr("Quantity must be a number above 0.");
              if (p === null) return setErr("Enter the price as a number.");
              setErr(null);
              void rpc(
                "add_custom_line",
                {
                  p_estimate_id: estimateId,
                  p_name: c.name,
                  p_quantity: q,
                  p_unit_price_cents: p,
                  p_tax_rate_ids: c.taxIds,
                },
                "Custom line added. This is recorded in the audit log.",
              ).then((ok) => {
                if (ok) {
                  setCustom(false);
                  setC({ ...c, name: "", qty: "1", price: "" });
                }
              });
            }}
          >
            <Field id={`cn-${estimateId}`} label="Custom line">
              <Input
                id={`cn-${estimateId}`}
                value={c.name}
                maxLength={120}
                onChange={(e) => setC({ ...c, name: e.target.value })}
              />
            </Field>
            <Field id={`cq-${estimateId}`} label="Qty">
              <Input
                id={`cq-${estimateId}`}
                inputMode="decimal"
                value={c.qty}
                onChange={(e) => setC({ ...c, qty: e.target.value })}
              />
            </Field>
            <Field id={`cp-${estimateId}`} label="Unit price">
              <Input
                id={`cp-${estimateId}`}
                inputMode="decimal"
                value={c.price}
                onChange={(e) => setC({ ...c, price: e.target.value })}
              />
            </Field>
            <div className="flex flex-wrap gap-4 sm:col-span-3">
              {taxes.map((t) => (
                <label key={t.id} className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={c.taxIds.includes(t.id)}
                    onChange={(e) =>
                      setC({
                        ...c,
                        taxIds: e.target.checked
                          ? [...c.taxIds, t.id]
                          : c.taxIds.filter((x) => x !== t.id),
                      })
                    }
                  />
                  {t.name} ({t.rate}%)
                </label>
              ))}
            </div>
            <div className="flex gap-2 sm:col-span-3">
              <Button type="submit" disabled={busy}>
                <Plus /> Add custom line
              </Button>
              <Button type="button" variant="ghost" onClick={() => setCustom(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button
            type="button"
            variant="ghost"
            className="self-start"
            onClick={() => setCustom(true)}
          >
            <Plus /> Custom line
          </Button>
        )
      ) : null}
      {err ? <p className="text-sm text-danger">{err}</p> : null}
    </div>
  );
}

function Totals({ est, money }: { est: Estimate; money: (c: number) => string }) {
  return (
    <dl className="ml-auto flex w-full max-w-xs flex-col gap-1">
      {est.savings_cents > 0 ? (
        <>
          <div className="flex justify-between text-muted-foreground">
            <dt>Before discounts</dt>
            <dd>{money(est.subtotal_before_cents)}</dd>
          </div>
          <div className="flex justify-between font-medium text-success">
            <dt>Total savings</dt>
            <dd>-{money(est.savings_cents)}</dd>
          </div>
        </>
      ) : null}
      <div className="flex justify-between">
        <dt>Subtotal</dt>
        <dd>{money(est.subtotal_cents)}</dd>
      </div>
      {est.tax_breakdown.map((t) => (
        <div key={t.id} className="flex justify-between">
          <dt>
            {t.name} ({Number(t.rate)}%)
          </dt>
          <dd>{money(Number(t.tax_cents))}</dd>
        </div>
      ))}
      <div className="flex justify-between border-t border-border pt-2 text-lg font-semibold">
        <dt>Total</dt>
        <dd>{money(est.total_cents)}</dd>
      </div>
    </dl>
  );
}

function EstimateActions({
  est,
  isCurrent,
  hasLines,
  invoiceNumber,
  busy,
  rpc,
  onPdf,
}: {
  est: Estimate;
  isCurrent: boolean;
  hasLines: boolean;
  invoiceNumber: number | undefined;
  busy: boolean;
  rpc: Rpc;
  onPdf: (kind: "estimate" | "invoice") => void;
}) {
  const [method, setMethod] = useState<ApprovalMethod>("in_person");
  const status = (s: string, extra: Record<string, unknown> = {}, ok?: string) =>
    void rpc("set_estimate_status", { p_estimate_id: est.id, p_status: s, ...extra }, ok);

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      {isCurrent && (est.status === "draft" || est.status === "sent") && hasLines ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field id={`am-${est.id}`} label="Customer approved">
            <select
              id={`am-${est.id}`}
              className={cn(selectClass, "w-auto")}
              value={method}
              onChange={(e) => setMethod(e.target.value as ApprovalMethod)}
            >
              {(Object.keys(APPROVAL_LABEL) as ApprovalMethod[]).map((m) => (
                <option key={m} value={m}>
                  {APPROVAL_OPTION[m]}
                </option>
              ))}
            </select>
          </Field>
          <Button
            disabled={busy}
            onClick={() => status("approved", { p_approval_method: method }, "Approval recorded.")}
          >
            <Check /> Mark approved
          </Button>
          {est.status === "draft" ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => status("sent", {}, "Marked as sent.")}
            >
              <Send /> Mark sent
            </Button>
          ) : null}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => status("declined", {}, "Marked as declined.")}
          >
            <X /> Declined
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {hasLines ? (
          <Button variant="outline" disabled={busy} onClick={() => onPdf("estimate")}>
            <Download /> Estimate PDF
          </Button>
        ) : null}
        {isCurrent && est.status === "approved" && invoiceNumber === undefined ? (
          <Button
            disabled={busy}
            onClick={() => void rpc("issue_invoice", { p_estimate_id: est.id }, "Invoice issued.")}
          >
            <FilePlus2 /> Issue invoice
          </Button>
        ) : null}
        {isCurrent && est.status !== "draft" ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "Start a new version? This one stays visible in the history" +
                    (invoiceNumber !== undefined
                      ? `, and invoice #${invoiceNumber} is replaced when you invoice the new version.`
                      : "."),
                )
              )
                void rpc("revise_estimate", { p_estimate_id: est.id }, "New version started.");
            }}
          >
            <RotateCcw /> Revise
          </Button>
        ) : null}
      </div>
    </div>
  );
}

type PaymentValues = {
  kind: PaymentKind;
  method: PaymentMethod;
  amount: string;
  paid_on: string;
  note: string;
};

function PaymentForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial: PaymentValues;
  submitLabel: string;
  busy: boolean;
  onSubmit: (v: Omit<PaymentValues, "amount"> & { amount_cents: number }) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [v, setV] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const id = onCancel ? "pe" : "pn";

  return (
    <form
      method="post"
      className="grid gap-3 rounded-md border border-dashed border-border p-3 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        const cents = parseMoney(v.amount);
        if (cents === null || cents <= 0) return setErr("Enter an amount above $0.");
        if (!v.paid_on) return setErr("Pick the date.");
        setErr(null);
        void onSubmit({
          kind: v.kind,
          method: v.method,
          amount_cents: cents,
          paid_on: v.paid_on,
          note: v.note,
        }).then((ok) => {
          if (ok && !onCancel) setV({ ...initial, amount: "", note: "" });
        });
      }}
    >
      <Field id={`${id}-kind`} label="Type">
        <select
          id={`${id}-kind`}
          className={selectClass}
          value={v.kind}
          onChange={(e) => setV({ ...v, kind: e.target.value as PaymentKind })}
        >
          {(Object.keys(KIND_LABEL) as PaymentKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </Field>
      <Field id={`${id}-method`} label="Method">
        <select
          id={`${id}-method`}
          className={selectClass}
          value={v.method}
          onChange={(e) => setV({ ...v, method: e.target.value as PaymentMethod })}
        >
          {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((k) => (
            <option key={k} value={k}>
              {METHOD_LABEL[k]}
            </option>
          ))}
        </select>
      </Field>
      <Field id={`${id}-amount`} label="Amount">
        <Input
          id={`${id}-amount`}
          inputMode="decimal"
          value={v.amount}
          onChange={(e) => setV({ ...v, amount: e.target.value })}
        />
      </Field>
      <Field id={`${id}-date`} label="Date">
        <Input
          id={`${id}-date`}
          type="date"
          value={v.paid_on}
          onChange={(e) => setV({ ...v, paid_on: e.target.value })}
        />
      </Field>
      <div className="sm:col-span-4">
        <Field id={`${id}-note`} label="Note (optional)">
          <Input
            id={`${id}-note`}
            value={v.note}
            maxLength={500}
            onChange={(e) => setV({ ...v, note: e.target.value })}
          />
        </Field>
      </div>
      {err ? <p className="text-sm text-danger sm:col-span-4">{err}</p> : null}
      <div className="flex gap-2 sm:col-span-4">
        <Button type="submit" disabled={busy}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function PaymentRow({
  payment: p,
  isAdmin,
  busy,
  money,
  rpc,
}: {
  payment: Payment;
  isAdmin: boolean;
  busy: boolean;
  money: (c: number) => string;
  rpc: Rpc;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <li className="p-3">
        <PaymentForm
          submitLabel="Save payment"
          busy={busy}
          initial={{
            kind: p.kind,
            method: p.method,
            amount: centsToInput(p.amount_cents),
            paid_on: p.paid_on,
            note: p.note ?? "",
          }}
          onCancel={() => setEditing(false)}
          onSubmit={(v) =>
            rpc(
              "update_payment",
              {
                p_payment_id: p.id,
                p_kind: v.kind,
                p_method: v.method,
                p_amount_cents: v.amount_cents,
                p_paid_on: v.paid_on,
                p_note: v.note,
              },
              "Payment updated. This is recorded in the audit log.",
            ).then((ok) => {
              if (ok) setEditing(false);
              return ok;
            })
          }
        />
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-3 p-3">
      <div className="min-w-40 flex-1">
        <p className="font-medium">
          {KIND_LABEL[p.kind]} · {METHOD_LABEL[p.method]}
        </p>
        <p className="text-sm text-muted-foreground">
          {p.paid_on}
          {p.note ? ` · ${p.note}` : ""}
        </p>
      </div>
      <p className={cn("font-semibold", p.kind === "refund" && "text-warning")}>
        {p.kind === "refund" ? "-" : ""}
        {money(p.amount_cents)}
      </p>
      {isAdmin ? (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Edit ${KIND_LABEL[p.kind].toLowerCase()} of ${money(p.amount_cents)}`}
            onClick={() => setEditing(true)}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label={`Delete ${KIND_LABEL[p.kind].toLowerCase()} of ${money(p.amount_cents)}`}
            onClick={() => {
              if (
                window.confirm(
                  `Delete this ${KIND_LABEL[p.kind].toLowerCase()} of ${money(p.amount_cents)}? This is recorded in the audit log.`,
                )
              )
                void rpc("delete_payment", { p_payment_id: p.id }, "Payment deleted.");
            }}
          >
            <Trash2 />
          </Button>
        </div>
      ) : null}
    </li>
  );
}
