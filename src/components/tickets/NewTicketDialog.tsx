import { useNavigate } from "@tanstack/react-router";
import { Camera, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { Field, selectClass } from "@/components/app/Field";
import { MoneyInput, PhoneInput } from "@/components/app/MaskedInputs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { METHOD_LABEL, type PaymentMethod } from "@/lib/estimates";
import { percentOf, previewTotals, titleFromText, type PreviewLine } from "@/lib/intake";
import {
  type CatalogItem,
  discountActiveOn,
  discountLabel,
  type DiscountType,
  fetchCatalog,
  fetchTaxRates,
  formatMoney,
  parseMoney,
  parseQuantity,
  type TaxRate,
} from "@/lib/money";
import { friendlyDbError, roleAtLeast, type Membership } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import {
  fetchCustomFields,
  fetchMembers,
  shopToday,
  uploadPhotos,
  type CustomField,
  type Member,
} from "@/lib/tickets";
import { cn } from "@/lib/utils";
import { CustomFieldInput } from "./CustomFieldInput";
import { PickupCalendar } from "./PickupCalendar";

// Intake (spec §7.2, UX plan v2 PR 6, decision 69): the most frequent action.
// Only the customer and the description are required; pricing, a pick-up
// date and a payment are optional, because the point is to take the order and
// keep the customer informed. Everything is saved in one database call
// (create_ticket_full), which checks it all again: custom lines and discounts
// are Admin-only there too, and the database computes the real totals.

type Found = { id: string; label: string; since?: string };
type Discount = { type: DiscountType; value: string };
type DraftLine = {
  key: string;
  /** Set for a catalog line; a custom (one-off) line has none. */
  item: CatalogItem | null;
  name: string;
  qty: string;
  price: string;
  /** Custom lines only: null until "+ Add tax" is clicked. */
  taxIds: string[] | null;
  /** A manual discount (Admins). Catalog discounts apply on their own. */
  discount: Discount | null;
};
type PayMode = "later" | "full" | "deposit";

const EMPTY_CUSTOMER = { name: "", phone: "", email: "", channel: "sms" as "sms" | "email" };
let lineSeq = 0;

export function NewTicketDialog({
  open,
  onOpenChange,
  membership,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  membership: Membership;
}) {
  const shop = membership.shop;
  const isAdmin = roleAtLeast(membership.role, "admin");
  const money = (c: number) => formatMoney(c, shop.currency);
  const navigate = useNavigate();
  const today = shopToday(shop.time_zone);

  const [fields, setFields] = useState<CustomField[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [taxes, setTaxes] = useState<TaxRate[]>([]);

  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [customer, setCustomer] = useState<Found | null>(null);
  const [creating, setCreating] = useState(false);
  const [newCust, setNewCust] = useState(EMPTY_CUSTOMER);

  const [issue, setIssue] = useState("");
  const [title, setTitle] = useState("");
  const [titleEdited, setTitleEdited] = useState(false);
  const [shownFields, setShownFields] = useState<string[]>([]);
  const [custom, setCustom] = useState<Record<string, string | number | undefined>>({});

  const [lines, setLines] = useState<DraftLine[]>([]);
  const [catQuery, setCatQuery] = useState("");
  const [catOpen, setCatOpen] = useState(false);

  const [promised, setPromised] = useState("");
  const [assignee, setAssignee] = useState("");
  const [payMode, setPayMode] = useState<PayMode>("later");
  const [depositBy, setDepositBy] = useState<"amount" | "percent">("amount");
  const [depositAmount, setDepositAmount] = useState("");
  const [depositPercent, setDepositPercent] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [passcode, setPasscode] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const searchSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    void fetchCustomFields(shop.id)
      .then(setFields)
      .catch(() => setFields([]));
    void fetchMembers(shop.id)
      .then(setMembers)
      .catch(() => setMembers([]));
    void fetchCatalog(shop.id)
      .then((c) => setCatalog(c.filter((i) => !i.archived_at)))
      .catch(() => setCatalog([]));
    void fetchTaxRates(shop.id)
      .then((t) => setTaxes(t.filter((r) => r.active)))
      .catch(() => setTaxes([]));
  }, [open, shop.id]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || customer) return setFound([]);
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      const { data } = await getSupabase().rpc("search_shop", { p_shop_id: shop.id, p_query: q });
      if (seq !== searchSeq.current) return;
      const rows = ((data ?? []) as { kind: string; id: string; label: string }[]).filter(
        (r) => r.kind === "customer",
      );
      setFound(
        rows
          .filter((r, i) => rows.findIndex((x) => x.id === r.id) === i)
          .map((r) => ({ id: r.id, label: r.label })),
      );
    }, 200);
    return () => clearTimeout(timer);
  }, [query, customer, shop.id]);

  async function chooseCustomer(f: Found) {
    setCustomer(f);
    // "Customer since": read straight from the row (RLS: shop members only).
    const { data } = await getSupabase()
      .from("customers")
      .select("created_at")
      .eq("id", f.id)
      .maybeSingle();
    if (data?.created_at) {
      const since = new Intl.DateTimeFormat("en-CA", {
        month: "short",
        year: "numeric",
        timeZone: shop.time_zone,
      }).format(new Date(data.created_at as string));
      setCustomer((c) => (c?.id === f.id ? { ...c, since } : c));
    }
  }

  function reset() {
    setQuery("");
    setFound([]);
    setCustomer(null);
    setCreating(false);
    setNewCust(EMPTY_CUSTOMER);
    setIssue("");
    setTitle("");
    setTitleEdited(false);
    setShownFields([]);
    setCustom({});
    setLines([]);
    setCatQuery("");
    setPromised("");
    setAssignee("");
    setPayMode("later");
    setDepositBy("amount");
    setDepositAmount("");
    setDepositPercent("");
    setMethod("card");
    setPasscode("");
    setPhotos([]);
    setTerms(false);
    setError(null);
  }

  // The title follows the description until someone types their own.
  const shownTitle = titleEdited ? title : titleFromText(issue);

  // Details: required custom fields always show; optional ones are added from
  // the "+ Add detail" menu.
  const detailFields = fields.filter((f) => f.required || shownFields.includes(f.id));
  const moreFields = fields.filter((f) => !f.required && !shownFields.includes(f.id));

  const catalogMatches = useMemo(() => {
    const q = catQuery.trim().toLowerCase();
    return catalog.filter((i) => !q || i.name.toLowerCase().includes(q)).slice(0, 8);
  }, [catalog, catQuery]);

  // What each line will cost, for the preview only (the database saves the
  // real numbers with the same math).
  function previewLine(l: DraftLine): PreviewLine {
    const qty = parseQuantity(l.qty) ?? 0;
    const manual = l.discount ? toDiscount(l.discount) : null;
    if (l.item) {
      const catalogDiscount =
        l.item.discount_type && discountActiveOn(l.item, today)
          ? { type: l.item.discount_type, value: l.item.discount_value ?? 0 }
          : null;
      return {
        quantity: qty,
        unitPriceCents: l.item.price_cents,
        discount: l.discount ? manual : catalogDiscount,
        taxRateIds: l.item.tax_rate_ids,
      };
    }
    return {
      quantity: qty,
      unitPriceCents: parseMoney(l.price) ?? 0,
      discount: manual,
      taxRateIds: l.taxIds ?? [],
    };
  }
  const totals = previewTotals(lines.map(previewLine), taxes);
  const hasTotal = totals.totalCents > 0;
  const depositCents =
    depositBy === "percent" && hasTotal
      ? percentOf(totals.totalCents, Number(depositPercent) || 0)
      : (parseMoney(depositAmount) ?? 0);

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addCatalogLine(item: CatalogItem) {
    setLines((ls) => [
      ...ls,
      {
        key: `l${++lineSeq}`,
        item,
        name: item.name,
        qty: "1",
        price: "",
        taxIds: null,
        discount: null,
      },
    ]);
    setCatQuery("");
    setCatOpen(false);
  }
  function addCustomLine() {
    setLines((ls) => [
      ...ls,
      {
        key: `l${++lineSeq}`,
        item: null,
        name: "",
        qty: "1",
        price: "",
        taxIds: null,
        discount: null,
      },
    ]);
  }

  // A problem with the lines or payment, in plain words, or null.
  function pricingProblem(): string | null {
    for (const [i, l] of lines.entries()) {
      const label = l.item?.name || l.name.trim() || `Line ${i + 1}`;
      if (!parseQuantity(l.qty)) return `${label}: enter a quantity, for example 1 or 1.5.`;
      if (!l.item) {
        if (!l.name.trim()) return `Line ${i + 1}: enter what it's for.`;
        if (parseMoney(l.price) === null) return `${label}: enter a price.`;
      }
      if (l.discount && !toDiscount(l.discount)) return `${label}: enter the discount.`;
    }
    if (payMode === "full" && !hasTotal) return "Add a price before marking it paid in full.";
    if (payMode === "deposit") {
      if (depositCents <= 0) return "Enter the deposit amount.";
      if (hasTotal && depositCents > totals.totalCents)
        return `The deposit can't be more than the total (${money(totals.totalCents)}).`;
    }
    return null;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!customer && !creating) return setError("Choose a customer or add a new one.");
    if (creating && !customer) {
      if (!newCust.name.trim()) return setError("Enter the customer's name.");
      if (!newCust.phone.trim() && !newCust.email.trim())
        return setError("Enter a phone number or an email so you can reach the customer.");
    }
    if (!issue.trim()) return setError("Describe what needs doing.");
    for (const f of detailFields)
      if (f.required && (custom[f.id] === undefined || custom[f.id] === ""))
        return setError(`${f.label} is required.`);
    const problem = pricingProblem();
    if (problem) return setError(problem);
    if (shop.terms_text && !terms) return setError("The customer needs to accept the terms.");

    setSaving(true);
    try {
      const sb = getSupabase();
      let customerId = customer?.id;
      if (!customerId) {
        const { data, error } = await sb.rpc("save_customer", {
          p_shop_id: shop.id,
          p_customer_id: null,
          p_name: newCust.name,
          p_phone: newCust.phone || null,
          p_email: newCust.email || null,
          p_preferred_channel: newCust.channel,
          p_notes: null,
        });
        if (error) throw error;
        customerId = data as string;
        // If the ticket fails below, trying again reuses this customer
        // instead of creating a duplicate.
        setCustomer({ id: customerId, label: newCust.name });
        setCreating(false);
      }
      const cleanCustom = Object.fromEntries(
        Object.entries(custom).filter(
          ([id, v]) => v !== undefined && v !== "" && detailFields.some((f) => f.id === id),
        ),
      );
      const { data, error } = await sb.rpc("create_ticket_full", {
        p_shop_id: shop.id,
        p_customer_id: customerId,
        p_issue_description: issue,
        p_item_name: shownTitle.trim() || null,
        p_promised_date: promised || null,
        p_assigned_to: assignee || null,
        p_custom_fields: cleanCustom,
        p_passcode: passcode || null,
        p_terms_accepted: terms,
        p_lines: lines.map(linePayload),
        p_payment:
          payMode === "full"
            ? { full: true, method }
            : payMode === "deposit"
              ? { amount_cents: depositCents, method }
              : null,
      });
      if (error) throw error;
      const created = (data as { ticket_id: string; ticket_number: number }[])[0];
      if (!created) throw new Error("no ticket");
      const problems = photos.length ? await uploadPhotos(shop.id, created.ticket_id, photos) : [];
      reset();
      onOpenChange(false);
      // Back to the board (not the ticket) with a short confirmation.
      await navigate({
        to: "/app/board",
        search: {
          created: created.ticket_number,
          ticket: created.ticket_id,
          ...(problems.length ? { photoProblems: problems.length } : {}),
        },
      });
    } catch (err) {
      setError(friendlyDbError(err));
    } finally {
      setSaving(false);
    }
  }

  const isElectronics = shop.vertical === "electronics";
  const sectionTitle = "text-base font-semibold";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto bg-background text-foreground sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">New ticket</DialogTitle>
          <DialogDescription>Only the customer and the description are required.</DialogDescription>
        </DialogHeader>
        <form method="post" onSubmit={save} noValidate className="flex min-w-0 flex-col gap-6">
          {/* Customer */}
          <section className="flex flex-col gap-3">
            {customer ? (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Customer *</span>
                <div className="flex items-center justify-between gap-3 rounded-md border border-input bg-surface-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{customer.label}</p>
                    {customer.since ? (
                      <p className="text-sm text-muted-foreground">
                        Customer since {customer.since}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCustomer(null);
                      setQuery("");
                    }}
                  >
                    <X /> Change
                  </Button>
                </div>
              </div>
            ) : creating ? (
              // A tinted panel so a new customer stands out from the search.
              <div className="grid gap-4 rounded-md border border-input bg-surface-1 p-4 sm:grid-cols-2">
                <div className="flex items-center justify-between sm:col-span-2">
                  <h3 className={sectionTitle}>New customer</h3>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCreating(false)}
                  >
                    Search instead
                  </Button>
                </div>
                <div className="sm:col-span-2">
                  <Field id="nc-name" label="Name *">
                    <Input
                      id="nc-name"
                      value={newCust.name}
                      onChange={(e) => setNewCust({ ...newCust, name: e.target.value })}
                      maxLength={120}
                      autoFocus
                    />
                  </Field>
                </div>
                <Field id="nc-phone" label="Mobile phone *">
                  <PhoneInput
                    id="nc-phone"
                    value={newCust.phone}
                    onValueChange={(phone) => setNewCust({ ...newCust, phone })}
                  />
                </Field>
                <Field id="nc-email" label="Email *">
                  <Input
                    id="nc-email"
                    type="email"
                    value={newCust.email}
                    onChange={(e) => setNewCust({ ...newCust, email: e.target.value })}
                  />
                </Field>
                <p className="-mt-2 text-sm text-muted-foreground sm:col-span-2">
                  A phone number, an email, or both.
                </p>
                <Field id="nc-channel" label="Prefers">
                  <select
                    id="nc-channel"
                    className={selectClass}
                    value={newCust.channel}
                    onChange={(e) =>
                      setNewCust({ ...newCust, channel: e.target.value as "sms" | "email" })
                    }
                  >
                    <option value="sms">Text message</option>
                    <option value="email">Email</option>
                  </select>
                </Field>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <label htmlFor="cust-search" className="text-sm font-medium">
                  Customer *
                </label>
                <div className="flex gap-2">
                  <Input
                    id="cust-search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Name, phone or email"
                    autoFocus
                    autoComplete="off"
                    className="min-w-0 flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 shrink-0"
                    onClick={() => {
                      setCreating(true);
                      setNewCust({
                        ...EMPTY_CUSTOMER,
                        name: /\d|@/.test(query) ? "" : query,
                        phone: /^[\d\s()+-]+$/.test(query) ? query : "",
                        email: query.includes("@") ? query : "",
                      });
                    }}
                  >
                    <Plus /> Customer
                  </Button>
                </div>
                {found.length ? (
                  <ul className="divide-y divide-border rounded-md border border-border bg-surface-2">
                    {found.map((f) => (
                      <li key={f.id}>
                        <button
                          type="button"
                          className="flex min-h-11 w-full items-center px-4 text-left hover:bg-accent"
                          onClick={() => void chooseCustomer(f)}
                        >
                          {f.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}
          </section>

          {/* What needs doing */}
          <section className="flex flex-col gap-4">
            <Field id="issue" label="Description *">
              <Textarea
                id="issue"
                value={issue}
                onChange={(e) => setIssue(e.target.value)}
                rows={3}
                maxLength={4000}
                placeholder="What the customer brought in and what needs doing"
                className="bg-surface-2 text-base"
              />
            </Field>
            <Field
              id="title"
              label="Title"
              hint={titleEdited ? undefined : "Filled in from the description. You can change it."}
            >
              <Input
                id="title"
                value={shownTitle}
                onChange={(e) => {
                  setTitleEdited(true);
                  setTitle(e.target.value);
                }}
                maxLength={120}
              />
            </Field>
            {detailFields.map((f) => (
              <div key={f.id} className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Field
                    id={`cf-${f.id}`}
                    label={f.required ? `${f.label} *` : f.label}
                    hint={f.help_text}
                  >
                    <CustomFieldInput
                      id={`cf-${f.id}`}
                      field={f}
                      value={custom[f.id]}
                      onChange={(v) => setCustom({ ...custom, [f.id]: v })}
                    />
                  </Field>
                </div>
                {f.required ? null : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11"
                    aria-label={`Remove ${f.label}`}
                    onClick={() => {
                      setShownFields(shownFields.filter((id) => id !== f.id));
                      setCustom({ ...custom, [f.id]: undefined });
                    }}
                  >
                    <X />
                  </Button>
                )}
              </div>
            ))}
            {moreFields.length ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" className="w-fit">
                    <Plus /> Add detail
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {moreFields.map((f) => (
                    <DropdownMenuItem
                      key={f.id}
                      onSelect={() => setShownFields([...shownFields, f.id])}
                    >
                      {f.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </section>

          {/* Items and price (optional) */}
          <section className="flex flex-col gap-3">
            <h3 className={sectionTitle}>
              Items and price <span className="font-normal text-muted-foreground">(optional)</span>
            </h3>
            {lines.length ? (
              <ul className="flex flex-col gap-3">
                {lines.map((l) => (
                  <LineRow
                    key={l.key}
                    line={l}
                    isAdmin={isAdmin}
                    taxes={taxes}
                    today={today}
                    lineTotal={money(lineTotalOf(previewLine(l)))}
                    currency={shop.currency}
                    onChange={(patch) => updateLine(l.key, patch)}
                    onRemove={() => setLines(lines.filter((x) => x.key !== l.key))}
                  />
                ))}
              </ul>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <div className="relative min-w-0 flex-1">
                <Input
                  aria-label="Search the catalog"
                  value={catQuery}
                  onChange={(e) => {
                    setCatQuery(e.target.value);
                    setCatOpen(true);
                  }}
                  onFocus={() => setCatOpen(true)}
                  onBlur={() => setCatOpen(false)}
                  placeholder={catalog.length ? "Search the catalog" : "The catalog is empty"}
                  disabled={!catalog.length}
                  autoComplete="off"
                />
                {catOpen && catalogMatches.length ? (
                  <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border bg-background shadow-md">
                    {catalogMatches.map((i) => (
                      <li key={i.id}>
                        <button
                          type="button"
                          // mousedown, not click: the input's blur would close
                          // the list before a click lands.
                          onMouseDown={(e) => {
                            e.preventDefault();
                            addCatalogLine(i);
                          }}
                          className="flex min-h-11 w-full items-center justify-between gap-3 px-4 text-left hover:bg-accent"
                        >
                          <span className="truncate">{i.name}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {money(i.price_cents)}
                            {i.unit === "hour" ? "/h" : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {isAdmin ? (
                <Button type="button" variant="outline" className="w-fit" onClick={addCustomLine}>
                  <Plus /> Custom line
                </Button>
              ) : null}
            </div>
            {lines.length ? (
              <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm tabular-nums">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="text-right">{money(totals.subtotalBeforeCents)}</dd>
                {totals.savingsCents ? (
                  <>
                    <dt className="text-muted-foreground">Discounts</dt>
                    <dd className="text-right">−{money(totals.savingsCents)}</dd>
                  </>
                ) : null}
                {totals.taxes.map((t) => (
                  <div key={t.id} className="contents">
                    <dt className="text-muted-foreground">
                      {t.name} ({t.rate}%)
                    </dt>
                    <dd className="text-right">{money(t.taxCents)}</dd>
                  </div>
                ))}
                <dt className="border-t border-border pt-1 text-base font-semibold">Total</dt>
                <dd className="border-t border-border pt-1 text-right text-base font-semibold">
                  {money(totals.totalCents)}
                </dd>
              </dl>
            ) : null}
          </section>

          {/* Payment (optional) */}
          <section className="flex flex-col gap-3">
            <h3 className={sectionTitle}>Payment</h3>
            <div role="radiogroup" aria-label="Payment" className="flex flex-wrap gap-2">
              {(
                [
                  ["later", "Pay at pick-up"],
                  ...(hasTotal ? [["full", "Paid in full"] as const] : []),
                  ["deposit", hasTotal ? "Partial (deposit)" : "Deposit"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={payMode === mode}
                  onClick={() => setPayMode(mode)}
                  className={cn(
                    "min-h-11 rounded-md border px-4 text-sm font-medium",
                    payMode === mode
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-surface-2 hover:bg-accent",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {payMode === "full" && !hasTotal ? (
              <p className="text-sm text-muted-foreground">Add a price to mark it paid in full.</p>
            ) : null}
            {payMode !== "later" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {payMode === "deposit" ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <label htmlFor="deposit" className="text-sm font-medium">
                        Deposit *
                      </label>
                      {hasTotal ? (
                        <button
                          type="button"
                          className="text-sm font-medium underline"
                          onClick={() =>
                            setDepositBy(depositBy === "amount" ? "percent" : "amount")
                          }
                        >
                          {depositBy === "amount" ? "Use %" : "Use amount"}
                        </button>
                      ) : null}
                    </div>
                    {depositBy === "percent" && hasTotal ? (
                      <>
                        <Input
                          id="deposit"
                          inputMode="decimal"
                          value={depositPercent}
                          onChange={(e) =>
                            setDepositPercent(e.target.value.replace(/[^\d.]/g, "").slice(0, 6))
                          }
                          placeholder="50"
                          aria-describedby="deposit-hint"
                        />
                        <p id="deposit-hint" className="text-sm text-muted-foreground">
                          % of {money(totals.totalCents)} = {money(depositCents)}
                        </p>
                      </>
                    ) : (
                      <MoneyInput
                        id="deposit"
                        value={depositAmount}
                        onValueChange={setDepositAmount}
                      />
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-medium">Amount</span>
                    <p className="flex h-11 items-center tabular-nums">
                      {money(totals.totalCents)}
                    </p>
                  </div>
                )}
                <Field id="pay-method" label="Paid by">
                  <select
                    id="pay-method"
                    className={selectClass}
                    value={method}
                    onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                  >
                    {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
                      <option key={m} value={m}>
                        {METHOD_LABEL[m]}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            ) : null}
          </section>

          {/* Pick-up date and who's on it (optional) */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className={sectionTitle}>
                Pick-up date <span className="font-normal text-muted-foreground">(optional)</span>
              </h3>
              {promised ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setPromised("")}>
                  <X /> Clear
                </Button>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {promised
                ? `Ready by ${new Intl.DateTimeFormat("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${promised}T00:00:00Z`))}.`
                : "The number on a day is how many open tickets are already due then."}
            </p>
            <PickupCalendar
              shopId={shop.id}
              today={today}
              value={promised}
              onChange={setPromised}
            />
            <Field id="assignee" label="Assigned to">
              <select
                id="assignee"
                className={selectClass}
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">Nobody yet</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name || m.email}
                  </option>
                ))}
              </select>
            </Field>
            {isElectronics ? (
              <Field
                id="passcode"
                label="Device passcode"
                hint="Stored encrypted. Only the owner, admins and the assigned person can reveal it. Deleted at pickup."
              >
                <Input
                  id="passcode"
                  type="password"
                  autoComplete="off"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  maxLength={64}
                />
              </Field>
            ) : null}
          </section>

          {/* Photos */}
          <section className="flex flex-col gap-2">
            <label
              htmlFor="photos"
              className="inline-flex h-11 w-fit cursor-pointer items-center gap-2 rounded-md border border-input px-4 font-medium hover:bg-accent"
            >
              <Camera className="size-5" aria-hidden /> Add condition photos
            </label>
            <input
              id="photos"
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="sr-only"
              onChange={(e) => setPhotos([...photos, ...Array.from(e.target.files ?? [])])}
            />
            {photos.length ? (
              <p className="text-sm text-muted-foreground">
                {photos.length} photo{photos.length > 1 ? "s" : ""} ready to upload (10 MB max
                each).
              </p>
            ) : null}
          </section>

          {/* Terms */}
          {shop.terms_text ? (
            <section className="flex flex-col gap-2 rounded-md border border-border bg-card p-4">
              <p className="max-h-28 overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground">
                {shop.terms_text}
              </p>
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={terms}
                  onChange={(e) => setTerms(e.target.checked)}
                />
                <span>The customer accepts these terms *</span>
              </label>
            </section>
          ) : null}

          {error ? <FormAlert tone="error">{error}</FormAlert> : null}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="lg" disabled={saving}>
              {saving ? "Creating…" : "Create ticket"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A typed discount as numbers, or null if it isn't a valid amount yet. */
function toDiscount(d: Discount): { type: DiscountType; value: number } | null {
  if (d.type === "fixed") {
    const cents = parseMoney(d.value);
    return cents ? { type: "fixed", value: cents / 100 } : null;
  }
  const pct = Number(d.value);
  return d.value.trim() && pct > 0 && pct <= 100 ? { type: "percent", value: pct } : null;
}

function lineTotalOf(l: PreviewLine): number {
  return previewTotals([{ ...l, taxRateIds: [] }], []).subtotalCents;
}

/** The JSON create_ticket_full expects for one line. */
function linePayload(l: DraftLine) {
  const qty = parseQuantity(l.qty) ?? 1;
  const discount = l.discount ? toDiscount(l.discount) : null;
  const d = discount ? { discount_type: discount.type, discount_value: discount.value } : {};
  return l.item
    ? { catalog_item_id: l.item.id, quantity: qty, ...d }
    : {
        name: l.name.trim(),
        quantity: qty,
        price_cents: parseMoney(l.price) ?? 0,
        tax_rate_ids: l.taxIds ?? [],
        ...d,
      };
}

function LineRow({
  line: l,
  isAdmin,
  taxes,
  today,
  lineTotal,
  currency,
  onChange,
  onRemove,
}: {
  line: DraftLine;
  isAdmin: boolean;
  taxes: TaxRate[];
  today: string;
  lineTotal: string;
  currency: string;
  onChange: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
}) {
  const id = `line-${l.key}`;
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
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {l.item ? (
            <>
              <p className="font-medium">{l.item.name}</p>
              <p className="text-sm text-muted-foreground">
                {formatMoney(l.item.price_cents, currency)}
                {l.item.unit === "hour" ? " per hour" : " each"}
                {l.item.tax_rate_ids.length ? ` · ${taxNames(l.item.tax_rate_ids)}` : ""}
                {catalogDiscount ? ` · ${catalogDiscount}` : ""}
              </p>
            </>
          ) : (
            <Field id={`${id}-name`} label="Custom line *">
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
              onChange={(e) => onChange({ qty: e.target.value.replace(/[^\d.]/g, "").slice(0, 8) })}
            />
          </Field>
        </div>
        {l.item ? null : (
          <div className="w-32">
            <Field id={`${id}-price`} label="Price *">
              <MoneyInput
                id={`${id}-price`}
                value={l.price}
                onValueChange={(price) => onChange({ price })}
              />
            </Field>
          </div>
        )}
        <p className="ml-auto flex h-11 items-center font-medium tabular-nums">{lineTotal}</p>
      </div>

      {l.discount ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-28">
            <Field id={`${id}-dtype`} label="Discount">
              <select
                id={`${id}-dtype`}
                className={selectClass}
                value={l.discount.type}
                onChange={(e) =>
                  onChange({ discount: { type: e.target.value as DiscountType, value: "" } })
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
                onValueChange={(value) => onChange({ discount: { type: "fixed", value } })}
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
                    },
                  })
                }
              />
            )}
          </div>
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

      {!l.item && l.taxIds !== null ? (
        <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <legend className="sr-only">Taxes on this line</legend>
          <span className="text-sm font-medium">Tax</span>
          {taxes.map((t) => (
            <label key={t.id} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={l.taxIds?.includes(t.id) ?? false}
                onChange={(e) =>
                  onChange({
                    taxIds: e.target.checked
                      ? [...(l.taxIds ?? []), t.id]
                      : (l.taxIds ?? []).filter((x) => x !== t.id),
                  })
                }
              />
              {t.name} ({t.rate}%)
            </label>
          ))}
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
        </fieldset>
      ) : null}

      {(isAdmin && !l.discount) || (!l.item && l.taxIds === null && taxes.length) ? (
        <div className="flex flex-wrap gap-2">
          {isAdmin && !l.discount ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange({ discount: { type: "percent", value: "" } })}
            >
              <Plus /> Add discount
            </Button>
          ) : null}
          {!l.item && l.taxIds === null && taxes.length ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              // Revealed with every active rate ticked: the usual case.
              onClick={() => onChange({ taxIds: taxes.map((t) => t.id) })}
            >
              <Plus /> Add tax
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
