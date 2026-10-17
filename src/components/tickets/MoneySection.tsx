import { Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Field, Panel, selectClass } from "@/components/app/Field";
import { FormAlert } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { MoneyInput } from "@/components/app/MaskedInputs";
import { Input } from "@/components/ui/input";
import {
  balance,
  type Estimate,
  fetchMoney,
  KIND_LABEL,
  METHOD_LABEL,
  type MoneyData,
  type Payment,
  type PaymentKind,
  type PaymentMethod,
} from "@/lib/estimates";
import {
  type CatalogItem,
  centsToInput,
  fetchCatalog,
  fetchTaxRates,
  formatMoney,
  parseMoney,
  type TaxRate,
} from "@/lib/money";
import { logoUrl } from "@/lib/logo";
import { friendlyDbError, roleAtLeast, type Membership } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import { shopToday, type Ticket } from "@/lib/tickets";
import { cn } from "@/lib/utils";
import { ServicesPanel } from "./ServicesPanel";

type Msg = { tone: "error" | "info"; text: string } | null;

type Rpc = (name: string, args: Record<string, unknown>, ok?: string) => Promise<boolean>;

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
      <Panel title="Services & price">
        {msg ? (
          <FormAlert tone={msg.tone}>{msg.text}</FormAlert>
        ) : (
          <p className="text-muted-foreground">Loading…</p>
        )}
      </Panel>
    );
  }

  const bal = balance(data);

  return (
    <>
      <ServicesPanel
        ticketId={ticket.id}
        estimates={data.estimates}
        allLines={data.lines}
        invoices={data.invoices}
        catalog={catalog}
        taxes={taxes}
        isAdmin={isAdmin}
        busy={busy}
        money={money}
        currency={shop.currency}
        timeZone={shop.time_zone}
        msg={msg}
        rpc={rpc}
        onError={(text) => setMsg({ tone: "error", text })}
        onPdf={(kind, est) => void pdfFor(kind, est)}
      />

      <Panel title="Payments">
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-3 gap-3 rounded-md border border-border p-4 text-center">
            <div>
              <dt className="text-sm text-muted-foreground">
                {bal.basis === "invoice" ? "Invoice total" : "Total"}
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
        <MoneyInput
          id={`${id}-amount`}
          value={v.amount}
          onValueChange={(amount) => setV({ ...v, amount })}
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
