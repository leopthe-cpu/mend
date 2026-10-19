import { Check, ChevronDown, Pencil, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";

import { MoneyInput } from "@/components/app/MaskedInputs";
import { Panel } from "@/components/app/Field";
import { FormAlert } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  APPROVAL_LABEL,
  type ApprovalMethod,
  type Estimate,
  type Invoice,
  type Line,
  lineDiscountText,
  quantityText,
} from "@/lib/estimates";
import {
  type CatalogItem,
  centsToInput,
  discountActiveOn,
  discountLabel,
  parseMoney,
  parseQuantity,
  type TaxRate,
} from "@/lib/money";
import { friendlyDbError } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import { parseTicketDiscount, type TicketDiscountDraft } from "@/lib/ticketDiscount";
import { shopToday } from "@/lib/tickets";
import { TicketDiscountInput } from "./TicketDiscountInput";

// "Services & price" on the ticket page (decision 83). It mirrors the
// new-ticket form: a service search, compact rows that lock with a pencil to
// edit, one whole-ticket discount and the totals. The estimate workflow is
// called a "quote" and lives in one "Quote" menu (send, customer approved or
// declined, change services, PDF, invoice), with its state on one line.
// Every change still goes through the money RPCs, which check roles.

type Rpc = (name: string, args: Record<string, unknown>, ok?: string) => Promise<boolean>;

const APPROVAL_OPTION: Record<ApprovalMethod, string> = {
  in_person: "In person",
  phone: "By phone",
  text_reply: "By text reply",
  email_reply: "By email reply",
  other: "Another way",
};

export function ServicesPanel({
  ticketId,
  estimates,
  allLines,
  invoices,
  catalog,
  taxes,
  isAdmin,
  busy,
  money,
  currency,
  timeZone,
  msg,
  rpc,
  onError,
  onPdf,
}: {
  ticketId: string;
  estimates: Estimate[];
  allLines: Line[];
  invoices: Invoice[];
  catalog: CatalogItem[];
  taxes: TaxRate[];
  isAdmin: boolean;
  busy: boolean;
  money: (c: number) => string;
  currency: string;
  timeZone: string;
  msg: { tone: "error" | "info"; text: string } | null;
  rpc: Rpc;
  onError: (text: string) => void;
  onPdf: (kind: "estimate" | "invoice", est: Estimate) => void;
}) {
  const current = estimates.find((e) => e.status !== "superseded") ?? null;
  const earlier = estimates.filter((e) => e.status === "superseded");
  const lines = useMemo(
    () => (current ? allLines.filter((l) => l.estimate_id === current.id) : []),
    [allLines, current],
  );
  const editable = !current || current.status === "draft";
  const invoice = current ? invoices.find((i) => i.estimate_id === current.id) : undefined;
  const today = shopToday(timeZone);
  const day = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat("en-CA", { timeZone, month: "short", day: "numeric" }).format(
          new Date(iso),
        )
      : "";

  // The draft quote to add to, started on the first service.
  async function draftId(): Promise<string | null> {
    if (current?.status === "draft") return current.id;
    if (current) return null;
    const { data, error } = await getSupabase().rpc("start_estimate", { p_ticket_id: ticketId });
    if (error) {
      onError(friendlyDbError(error));
      return null;
    }
    return data as string;
  }

  async function addCatalog(item: CatalogItem) {
    const id = await draftId();
    if (id)
      await rpc("add_estimate_line", {
        p_estimate_id: id,
        p_catalog_item_id: item.id,
        p_quantity: 1,
      });
  }
  async function addCustom(name: string, qty: number, cents: number) {
    const id = await draftId();
    if (!id) return false;
    return rpc("add_custom_line", {
      p_estimate_id: id,
      p_name: name,
      p_quantity: qty,
      p_unit_price_cents: cents,
      p_tax_rate_ids: taxes.filter((t) => t.active).map((t) => t.id),
    });
  }

  const quoteState = !current
    ? null
    : current.status === "draft"
      ? "Quote not sent yet"
      : current.status === "sent"
        ? `Quote sent ${day(current.sent_at)}`
        : current.status === "approved"
          ? `Customer approved ${current.approval_method ? APPROVAL_LABEL[current.approval_method] : ""} ${day(current.approved_at)}`
          : `Customer declined ${day(current.declined_at)}`;

  return (
    <Panel
      title="Services & price"
      action={
        current && lines.length ? (
          <QuoteMenu
            est={current}
            invoiceNumber={invoice?.invoice_number}
            busy={busy}
            rpc={rpc}
            onPdf={onPdf}
          />
        ) : null
      }
    >
      <div className="flex flex-col gap-3">
        {msg ? <FormAlert tone={msg.tone}>{msg.text}</FormAlert> : null}

        {editable ? (
          <ServiceSearch
            catalog={catalog}
            isAdmin={isAdmin}
            busy={busy}
            money={money}
            currency={currency}
            today={today}
            onPick={(i) => void addCatalog(i)}
            onCustom={addCustom}
          />
        ) : null}

        {lines.length ? (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface-2">
            {lines.map((l) => (
              <ServiceRow
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
        ) : (
          <p className="text-muted-foreground">No services yet.</p>
        )}

        {current && lines.length ? (
          <TicketDiscount
            est={current}
            editable={editable && isAdmin}
            busy={busy}
            money={money}
            rpc={rpc}
          />
        ) : null}

        {current && lines.length ? <Totals est={current} money={money} /> : null}

        {quoteState ? (
          <p className="text-sm text-muted-foreground">
            {quoteState.replace(/\s+/g, " ").trim()}.
            {!editable ? " To change the services, use Quote › Change services." : null}
            {invoice ? (
              <>
                {" "}
                Invoice #{invoice.invoice_number} issued {day(invoice.issued_at)}.
              </>
            ) : null}
          </p>
        ) : null}

        {earlier.length ? (
          <p className="text-sm text-muted-foreground">
            Earlier quotes:{" "}
            {earlier.map((e, i) => (
              <span key={e.id}>
                {i ? ", " : ""}
                <button
                  type="button"
                  className="underline underline-offset-4"
                  onClick={() => onPdf("estimate", e)}
                >
                  v{e.version} PDF
                </button>
              </span>
            ))}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

function QuoteMenu({
  est,
  invoiceNumber,
  busy,
  rpc,
  onPdf,
}: {
  est: Estimate;
  invoiceNumber: number | undefined;
  busy: boolean;
  rpc: Rpc;
  onPdf: (kind: "estimate" | "invoice", est: Estimate) => void;
}) {
  const status = (s: string, extra: Record<string, unknown> = {}, ok?: string) =>
    void rpc("set_estimate_status", { p_estimate_id: est.id, p_status: s, ...extra }, ok);
  const open = est.status === "draft" || est.status === "sent";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={busy}>
          Quote <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {est.status === "draft" ? (
          <DropdownMenuItem onSelect={() => status("sent", {}, "Quote marked as sent.")}>
            Mark as sent to the customer
          </DropdownMenuItem>
        ) : null}
        {open ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Customer approved</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {(Object.keys(APPROVAL_OPTION) as ApprovalMethod[]).map((m) => (
                <DropdownMenuItem
                  key={m}
                  onSelect={() =>
                    status("approved", { p_approval_method: m }, "Approval recorded.")
                  }
                >
                  {APPROVAL_OPTION[m]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        {open ? (
          <DropdownMenuItem onSelect={() => status("declined", {}, "Marked as declined.")}>
            Customer declined
          </DropdownMenuItem>
        ) : null}
        {est.status === "approved" && invoiceNumber === undefined ? (
          <DropdownMenuItem
            onSelect={() => void rpc("issue_invoice", { p_estimate_id: est.id }, "Invoice issued.")}
          >
            Issue invoice
          </DropdownMenuItem>
        ) : null}
        {est.status !== "draft" ? (
          <DropdownMenuItem
            onSelect={() => {
              if (
                window.confirm(
                  "Change the services? This starts a new quote; the current one stays in the history" +
                    (invoiceNumber !== undefined
                      ? `, and invoice #${invoiceNumber} is replaced when you invoice the new one.`
                      : "."),
                )
              )
                void rpc(
                  "revise_estimate",
                  { p_estimate_id: est.id },
                  "You can change the services now.",
                );
            }}
          >
            Change services
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onPdf("estimate", est)}>
          Download quote PDF
        </DropdownMenuItem>
        {invoiceNumber !== undefined ? (
          <DropdownMenuItem onSelect={() => onPdf("invoice", est)}>
            Download invoice #{invoiceNumber} PDF
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Search the catalog; "New service" (Admins) adds a one-off line. */
function ServiceSearch({
  catalog,
  isAdmin,
  busy,
  money,
  currency,
  today,
  onPick,
  onCustom,
}: {
  catalog: CatalogItem[];
  isAdmin: boolean;
  busy: boolean;
  money: (c: number) => string;
  currency: string;
  today: string;
  onPick: (i: CatalogItem) => void;
  onCustom: (name: string, qty: number, cents: number) => Promise<boolean>;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<{ name: string; price: string; qty: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return catalog.filter((i) => !s || i.name.toLowerCase().includes(s)).slice(0, 8);
  }, [catalog, q]);

  function pick(i: CatalogItem) {
    onPick(i);
    setQ("");
    setOpen(false);
  }
  function startCustom() {
    setCustom({ name: q.trim(), price: "", qty: "1" });
    setQ("");
    setOpen(false);
  }
  async function saveCustom() {
    if (!custom) return;
    const qty = parseQuantity(custom.qty);
    const cents = parseMoney(custom.price);
    if (!custom.name.trim()) return setErr("Name the service.");
    if (cents === null) return setErr("Enter the price.");
    if (qty === null) return setErr("Enter a quantity, like 1 or 1.5.");
    setErr(null);
    if (await onCustom(custom.name.trim(), qty, cents)) setCustom(null);
  }

  if (custom) {
    return (
      <div
        className="flex flex-col gap-2 rounded-lg border border-input bg-surface-1 p-3"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void saveCustom();
          }
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="New service name"
            placeholder="New service"
            className="min-w-40 flex-1"
            value={custom.name}
            maxLength={200}
            autoFocus
            onChange={(e) => setCustom({ ...custom, name: e.target.value })}
          />
          <MoneyInput
            aria-label="Price"
            className="w-24 text-right"
            value={custom.price}
            onValueChange={(price) => setCustom({ ...custom, price })}
          />
          <label className="text-sm text-muted-foreground" htmlFor="custom-qty">
            Qty
          </label>
          <Input
            id="custom-qty"
            inputMode="decimal"
            className="w-14 text-center"
            value={custom.qty}
            onChange={(e) => setCustom({ ...custom, qty: e.target.value })}
          />
          <Button
            type="button"
            size="icon"
            className="size-11"
            aria-label="Add service"
            disabled={busy}
            onClick={() => void saveCustom()}
          >
            <Check />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="Cancel"
            onClick={() => setCustom(null)}
          >
            <X />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Only on this ticket; not added to the catalog.
        </p>
        {err ? <p className="text-sm text-danger">{err}</p> : null}
      </div>
    );
  }

  return (
    <div className="relative">
      <Plus
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        className="pl-9"
        aria-label="Add a service"
        placeholder={catalog.length ? "Add a service: search the catalog" : "Add a service"}
        value={q}
        autoComplete="off"
        disabled={busy}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter") {
            e.preventDefault();
            const s = q.trim().toLowerCase();
            const m =
              catalog.find((i) => i.name.trim().toLowerCase() === s) ??
              (s ? matches[0] : undefined);
            if (m) pick(m);
            else if (isAdmin && s) startCustom();
          }
        }}
      />
      {open && (matches.length || isAdmin) ? (
        <ul
          data-picker-list
          className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-input bg-surface-2 shadow-lg ring-1 ring-black/5"
        >
          {matches.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(i);
                }}
                className="flex min-h-11 w-full items-center justify-between gap-3 px-4 text-left hover:bg-accent"
              >
                <span className="truncate">{i.name}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {money(i.price_cents)}
                  {i.unit === "hour" ? "/h" : ""}
                  {discountActiveOn(i, today) && i.discount_type
                    ? ` · ${discountLabel(i.discount_type, i.discount_value ?? 0, currency)}`
                    : ""}
                </span>
              </button>
            </li>
          ))}
          {isAdmin ? (
            <li>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  startCustom();
                }}
                className="flex min-h-11 w-full items-center gap-2 px-4 text-left font-semibold hover:bg-accent"
              >
                <Plus aria-hidden className="size-4" />
                {q.trim() ? (
                  <>New service &ldquo;{q.trim()}&rdquo;</>
                ) : (
                  "New service (not in the catalog)"
                )}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/** One service: locked with a pencil to edit quantity (and price, Admins). */
function ServiceRow({
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
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(String(l.quantity));
  const [price, setPrice] = useState(centsToInput(l.unit_price_cents));
  const [err, setErr] = useState<string | null>(null);
  const dText = lineDiscountText(l, money);
  const unitLabel = l.unit_snapshot === "hour" ? "Hours" : "Qty";

  async function save() {
    const q = parseQuantity(qty);
    const p = parseMoney(price);
    if (q === null) return setErr("Enter a quantity, like 1 or 1.5.");
    if (isAdmin && p === null) return setErr("Enter the price.");
    setErr(null);
    const args: Record<string, unknown> = { p_line_id: l.id };
    if (q !== l.quantity) args["p_quantity"] = q;
    if (isAdmin && p !== null && p !== l.unit_price_cents) args["p_unit_price_cents"] = p;
    if (Object.keys(args).length === 1) return setEditing(false);
    if (await rpc("update_estimate_line", args)) setEditing(false);
  }

  if (editing) {
    return (
      <li
        className="flex flex-col gap-1 px-3 py-2"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          }
          if (e.key === "Escape") setEditing(false);
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate">{l.name_snapshot}</span>
          {isAdmin ? (
            <MoneyInput
              aria-label={`Price for ${l.name_snapshot}`}
              className="w-24 text-right"
              value={price}
              onValueChange={setPrice}
            />
          ) : null}
          <label htmlFor={`q-${l.id}`} className="text-sm text-muted-foreground">
            {unitLabel}
          </label>
          <Input
            id={`q-${l.id}`}
            inputMode="decimal"
            className="w-16 text-center"
            value={qty}
            autoFocus
            onChange={(e) => setQty(e.target.value)}
          />
          <Button
            type="button"
            size="icon"
            className="size-11"
            aria-label={`Save ${l.name_snapshot}`}
            disabled={busy}
            onClick={() => void save()}
          >
            <Check />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="Cancel"
            onClick={() => setEditing(false)}
          >
            <X />
          </Button>
        </div>
        {err ? <p className="text-sm text-danger">{err}</p> : null}
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate">{l.name_snapshot}</p>
        <p className="text-sm text-muted-foreground">
          {quantityText(l)} × {money(l.unit_price_cents)}
          {l.unit_snapshot === "hour" ? " per hour" : ""}
          {l.tax_snapshot.length
            ? ` · ${l.tax_snapshot.map((t) => t.name).join(", ")}`
            : " · no tax"}
          {dText ? <span className="text-brand-text"> · {dText}</span> : null}
        </p>
      </div>
      <div className="text-right tabular-nums">
        {l.discount_cents > 0 ? (
          <p className="text-sm text-muted-foreground line-through">
            {money(l.line_subtotal_cents)}
          </p>
        ) : null}
        <p>{money(l.line_total_cents)}</p>
      </div>
      {editable ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label={`Edit ${l.name_snapshot}`}
            onClick={() => {
              setQty(String(l.quantity));
              setPrice(centsToInput(l.unit_price_cents));
              setEditing(true);
            }}
          >
            <Pencil />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label={`Remove ${l.name_snapshot}`}
            disabled={busy}
            onClick={() => void rpc("remove_estimate_line", { p_line_id: l.id })}
          >
            <X />
          </Button>
        </>
      ) : null}
    </li>
  );
}

/** The whole-ticket discount (decision 78), as a locked row like the services. */
function TicketDiscount({
  est,
  editable,
  busy,
  money,
  rpc,
}: {
  est: Estimate;
  editable: boolean;
  busy: boolean;
  money: (c: number) => string;
  rpc: Rpc;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TicketDiscountDraft>({ type: "percent", value: "" });
  const [err, setErr] = useState<string | null>(null);
  const label =
    est.discount_type === "percent"
      ? `${Number(est.discount_value)}%`
      : money(Math.round(Number(est.discount_value) * 100));

  async function save() {
    const d = parseTicketDiscount(draft);
    if (!d.ok) return setErr(d.message);
    setErr(null);
    if (
      await rpc("set_estimate_discount", {
        p_estimate_id: est.id,
        p_type: d.type,
        p_value: d.value,
      })
    )
      setEditing(false);
  }

  if (editing) {
    return (
      <div
        className="flex flex-col gap-1 rounded-md bg-surface-1 px-3 py-2"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          }
          if (e.key === "Escape") setEditing(false);
        }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex-1 text-sm font-semibold">Discount on the whole ticket</span>
          <TicketDiscountInput id={`td-${est.id}`} draft={draft} onChange={setDraft} />
          <Button
            type="button"
            size="icon"
            className="size-11"
            aria-label="Save discount"
            disabled={busy}
            onClick={() => void save()}
          >
            <Check />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="Cancel"
            onClick={() => setEditing(false)}
          >
            <X />
          </Button>
        </div>
        {err ? <p className="text-sm text-danger">{err}</p> : null}
      </div>
    );
  }

  if (!est.discount_type) {
    return editable ? (
      <Button
        type="button"
        variant="ghost"
        className="self-start underline underline-offset-4"
        onClick={() => {
          setDraft({ type: "percent", value: "" });
          setEditing(true);
        }}
      >
        Add discount
      </Button>
    ) : null;
  }

  return (
    <div className="flex items-center gap-2 rounded-md bg-surface-1 py-1 pr-1 pl-3">
      <span className="flex-1">Discount {label}</span>
      <span className="tabular-nums">−{money(est.discount_cents)}</span>
      {editable ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="Edit discount"
            onClick={() => {
              setDraft({
                type: est.discount_type ?? "percent",
                value: est.discount_value === null ? "" : String(est.discount_value),
              });
              setEditing(true);
            }}
          >
            <Pencil />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="Remove discount"
            disabled={busy}
            onClick={() =>
              void rpc("set_estimate_discount", {
                p_estimate_id: est.id,
                p_type: null,
                p_value: null,
              })
            }
          >
            <X />
          </Button>
        </>
      ) : null}
    </div>
  );
}

function Totals({ est, money }: { est: Estimate; money: (c: number) => string }) {
  const lineSavings = est.savings_cents - est.discount_cents;
  return (
    <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 tabular-nums">
      <dt className="text-muted-foreground">Subtotal</dt>
      <dd className="text-right">{money(est.subtotal_before_cents)}</dd>
      {lineSavings > 0 ? (
        <>
          <dt className="text-muted-foreground">Item discounts</dt>
          <dd className="text-right">−{money(lineSavings)}</dd>
        </>
      ) : null}
      {est.discount_cents > 0 ? (
        <>
          <dt className="text-muted-foreground">Ticket discount</dt>
          <dd className="text-right">−{money(est.discount_cents)}</dd>
        </>
      ) : null}
      {est.tax_breakdown.map((t) => (
        <div key={t.id} className="contents">
          <dt className="text-muted-foreground">
            {t.name} ({Number(t.rate)}%)
          </dt>
          <dd className="text-right">{money(Number(t.tax_cents))}</dd>
        </div>
      ))}
      <dt className="border-t border-border pt-1 text-lg font-semibold">Total</dt>
      <dd className="border-t border-border pt-1 text-right text-lg font-semibold">
        {money(est.total_cents)}
      </dd>
    </dl>
  );
}
