import { useNavigate } from "@tanstack/react-router";
import { Camera, CalendarDays, Check, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { Field, selectClass } from "@/components/app/Field";
import { MoneyInput, PhoneInput } from "@/components/app/MaskedInputs";
import { NewCustomerForm, type NewCustomerValues } from "@/components/customers/NewCustomerForm";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { focusFirstMissingField } from "@/lib/form";
import { previewTotals, titleFromText, type PreviewLine } from "@/lib/intake";
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

// New-ticket flow, PR 6b refinements (15 Oct): customer list opens on focus,
// services are typed or picked with a combobox (Admin-typed ones are saved to
// the catalog), payment is a single dropdown, and the pick-up date opens a
// popover calendar.

type Found = { id: string; label: string; since?: string; phone?: string; email?: string };
type Discount = { type: DiscountType; value: string; confirmed: boolean };
type DraftLine = {
  key: string;
  item: CatalogItem | null;
  name: string;
  qty: string;
  price: string;
  /** null until "+ Add tax" is clicked; only for new (non-catalog) services. */
  taxIds: string[] | null;
  /** The per-line discount (Admins only); counts only when confirmed. */
  discount: Discount | null;
};
type PayMode = "later" | "full" | "deposit";

let lineSeq = 0;

const EMPTY_CUSTOMER = { name: "", phone: "", email: "", channel: "sms" as "sms" | "email" };

const RATE_RE = /^\d{1,2}(\.\d{1,3})?$|^100(\.0{1,3})?$/;

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

function linePayload(l: DraftLine) {
  const qty = parseQuantity(l.qty) ?? 1;
  const discount =
    l.discount?.confirmed && l.discount.value.trim() ? toDiscount(l.discount) : null;
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

  const [issue, setIssue] = useState("");
  const [title, setTitle] = useState("");
  const [titleEdited, setTitleEdited] = useState(false);
  const [shownFields, setShownFields] = useState<string[]>([]);
  const [custom, setCustom] = useState<Record<string, string | number | undefined>>({});

  const [lines, setLines] = useState<DraftLine[]>([]);
  const [svcQuery, setSvcQuery] = useState("");
  const [svcOpen, setSvcOpen] = useState(false);

  const [promised, setPromised] = useState("");
  const [pickOpen, setPickOpen] = useState(false);
  const [assignee, setAssignee] = useState("");
  const [payMode, setPayMode] = useState<PayMode>("later");
  const [depositAmount, setDepositAmount] = useState("");
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
    // Customer picker: on focus, show recent customers; typing filters via
    // search_shop RPC (same behaviour as before).
    const q = query.trim();
    if (customer) return setFound([]);
    const seq = ++searchSeq.current;
    if (q.length >= 2) {
      // typed query — the existing search_shop RPC.
      const timer = setTimeout(async () => {
        const { data } = await getSupabase().rpc("search_shop", {
          p_shop_id: shop.id,
          p_query: q,
        });
        if (seq !== searchSeq.current) return;
        const rows = (
          (data ?? []) as { kind: string; id: string; label: string }[]
        ).filter((r) => r.kind === "customer");
        setFound(
          rows
            .filter((r, i) => rows.findIndex((x) => x.id === r.id) === i)
            .map((r) => ({ id: r.id, label: r.label })),
        );
      }, 200);
      return () => clearTimeout(timer);
    }
    // Empty query: show most recent customers (PR 6b: list opens on click).
    void getSupabase()
      .from("customers")
      .select("id, name, created_at")
      .eq("shop_id", shop.id)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data }) => {
        if (seq !== searchSeq.current) return;
        setFound(
          ((data ?? []) as { id: string; name: string; created_at: string }[]).map((c) => ({
            id: c.id,
            label: c.name,
          })),
        );
      });
  }, [query, customer, shop.id]);

  async function chooseCustomer(f: Found) {
    setCustomer(f);
    setQuery("");
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
    setIssue("");
    setTitle("");
    setTitleEdited(false);
    setShownFields([]);
    setCustom({});
    setLines([]);
    setSvcQuery("");
    setPromised("");
    setAssignee("");
    setPayMode("later");
    setDepositAmount("");
    setPasscode("");
    setPhotos([]);
    setTerms(false);
    setError(null);
  }

  const shownTitle = titleEdited ? title : titleFromText(issue);
  const detailFields = fields.filter((f) => f.required || shownFields.includes(f.id));
  const moreFields = fields.filter((f) => !f.required && !shownFields.includes(f.id));

  const svcMatches = useMemo(() => {
    const q = svcQuery.trim().toLowerCase();
    return catalog.filter((i) => !q || i.name.toLowerCase().includes(q)).slice(0, 8);
  }, [catalog, svcQuery]);

  function previewLine(l: DraftLine): PreviewLine {
    const qty = parseQuantity(l.qty) ?? 0;
    const manual = l.discount?.confirmed ? toDiscount(l.discount) : null;
    if (l.item) {
      const catalogDiscount =
        l.item.discount_type && discountActiveOn(l.item, today)
          ? { type: l.item.discount_type, value: l.item.discount_value ?? 0 }
          : null;
      return {
        quantity: qty,
        unitPriceCents: l.item.price_cents,
        discount: manual ?? catalogDiscount,
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
  const depositCents = parseMoney(depositAmount) ?? 0;

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function addServiceLine(item?: CatalogItem) {
    setLines((ls) => [
      ...ls,
      {
        key: `l${++lineSeq}`,
        item: item ?? null,
        name: item?.name ?? "",
        qty: "1",
        price: "",
        taxIds: null,
        discount: null,
      },
    ]);
    setSvcQuery("");
    setSvcOpen(false);
  }

  const isElectronics = shop.vertical === "electronics";
  const sectionTitle = "text-base font-semibold";

  const promisedDisplay = promised
    ? new Intl.DateTimeFormat("en-CA", {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${promised}T00:00:00Z`))
    : "";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // Use the shared helper for required fields, one at a time.
    const missing = focusFirstMissingField([
      {
        id: customer && !creating ? "cust-selected" : "cust-search",
        ok: !!(customer || creating),
        message: "Choose a customer or add a new one.",
      },
      { id: "issue", ok: !!issue.trim(), message: "Describe what needs doing." },
    ]);
    if (missing) {
      setError(missing.message);
      return;
    }
    if (creating && !customer) {
      // NewCustomerForm validates itself; this guard shouldn't be reached.
      return;
    }
    for (const f of detailFields) {
      if (f.required && (custom[f.id] === undefined || custom[f.id] === "")) {
        setError(`${f.label} is required.`);
        document.getElementById(`cf-${f.id}`)?.focus();
        return;
      }
    }
    // Check lines: unconfirmed discounts count as unfinished.
    for (const [i, l] of lines.entries()) {
      const label = l.item?.name || l.name.trim() || `Line ${i + 1}`;
      if (!parseQuantity(l.qty)) {
        setError(`${label}: enter a quantity, for example 1 or 1.5.`);
        return;
      }
      if (!l.item) {
        if (!l.name.trim()) {
          setError(`Line ${i + 1}: enter what it's for.`);
          return;
        }
        if (parseMoney(l.price) === null) {
          setError(`${label}: enter a price.`);
          return;
        }
      }
      if (l.discount && !l.discount.value.trim()) {
        // Discount opened but value empty — not confirmed, skip validation.
      } else if (l.discount && !l.discount.confirmed && l.discount.value.trim()) {
        setError(`${label}: confirm the discount with ✓.`);
        return;
      }
    }
    if (payMode === "full" && !hasTotal) {
      setError("Add a price before marking it paid.");
      return;
    }
    if (payMode === "deposit") {
      if (depositCents <= 0) {
        setError("Enter the deposit amount.");
        return;
      }
      if (hasTotal && depositCents > totals.totalCents) {
        setError(
          `The deposit can't be more than the total (${money(totals.totalCents)}).`,
        );
        return;
      }
    }
    if (shop.terms_text && !terms) {
      setError("The customer needs to accept the terms.");
      return;
    }

    setSaving(true);
    try {
      const sb = getSupabase();
      let customerId = customer?.id;
      if (!customerId) {
        const { data, error } = await sb.rpc("save_customer", {
          p_shop_id: shop.id,
          p_customer_id: null,
          p_name: showNewCust.name,
          p_phone: showNewCust.phone || null,
          p_email: showNewCust.email || null,
          p_preferred_channel: showNewCust.channel,
          p_notes: null,
        });
        if (error) throw error;
        customerId = data as string;
        setCustomer({ id: customerId, label: showNewCust.name });
        setCreating(false);
      }
      const cleanCustom = Object.fromEntries(
        Object.entries(custom).filter(
          ([id, v]) =>
            v !== undefined && v !== "" && detailFields.some((f) => f.id === id),
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
            ? { full: true }
            : payMode === "deposit"
              ? { amount_cents: depositCents }
              : null,
      });
      if (error) throw error;
      const created = (data as { ticket_id: string; ticket_number: number }[])[0];
      if (!created) throw new Error("no ticket");
      const problems = photos.length
        ? await uploadPhotos(shop.id, created.ticket_id, photos)
        : [];
      reset();
      onOpenChange(false);
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

  // Inline new-customer state: a single object kept next to the form.
  const [newCust, setNewCust] = useState(EMPTY_CUSTOMER);
  const showNewCust = creating ? newCust : EMPTY_CUSTOMER;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto bg-background text-foreground sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">New ticket</DialogTitle>
          <DialogDescription>
            Only the customer and the description are required.
          </DialogDescription>
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
                      onChange={(e) =>
                        setNewCust({ ...newCust, name: e.target.value })
                      }
                      maxLength={120}
                      autoFocus
                    />
                  </Field>
                </div>
                <Field id="nc-phone" label="Mobile phone *">
                  <PhoneInput
                    id="nc-phone"
                    value={newCust.phone}
                    onValueChange={(phone) =>
                      setNewCust({ ...newCust, phone })
                    }
                  />
                </Field>
                <Field id="nc-email" label="Email *">
                  <Input
                    id="nc-email"
                    type="email"
                    value={newCust.email}
                    onChange={(e) =>
                      setNewCust({ ...newCust, email: e.target.value })
                    }
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
                      setNewCust({
                        ...newCust,
                        channel: e.target.value as "sms" | "email",
                      })
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
                  <div className="relative min-w-0 flex-1">
                    <Input
                      id="cust-search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onFocus={() => searchSeq.current++}
                      placeholder="Name, phone or email"
                      autoFocus
                      autoComplete="off"
                    />
                    {found.length && !customer ? (
                      <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border bg-background shadow-md">
                        {found.map((f) => (
                          <li key={f.id}>
                            <button
                              type="button"
                              className="flex min-h-11 w-full items-center px-4 text-left hover:bg-accent"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                void chooseCustomer(f);
                              }}
                            >
                              {f.label}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
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
              </div>
            )}
          </section>

          {/* Description & details */}
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
              hint={
                titleEdited ? undefined : "Filled in from the description. You can change it."
              }
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

          {/* Service (optional) */}
          <section className="flex flex-col gap-3">
            <h3 className={sectionTitle}>
              Service{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </h3>
            {lines.length ? (
              <ul className="flex flex-col gap-3">
                {lines.map((l) => (
                  <ServiceLine
                    key={l.key}
                    line={l}
                    isAdmin={isAdmin}
                    taxes={taxes}
                    today={today}
                    currency={shop.currency}
                    onChange={(patch) => updateLine(l.key, patch)}
                    onRemove={() =>
                      setLines(lines.filter((x) => x.key !== l.key))
                    }
                  />
                ))}
              </ul>
            ) : null}
            <div className="relative">
              <Input
                aria-label="Add a service"
                value={svcQuery}
                onChange={(e) => {
                  setSvcQuery(e.target.value);
                  setSvcOpen(true);
                }}
                onFocus={() => setSvcOpen(true)}
                onBlur={() => setSvcOpen(false)}
                placeholder={
                  catalog.length ? "Search the catalog or type a new name" : "The catalog is empty"
                }
                disabled={!catalog.length && !isAdmin}
                autoComplete="off"
              />
              {svcOpen && svcMatches.length ? (
                <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border bg-background shadow-md">
                  {svcMatches.map((i) => (
                    <li key={i.id}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addServiceLine(i);
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
            {isAdmin && svcQuery.trim() ? (
              <Button
                type="button"
                variant="outline"
                className="w-fit"
                onClick={() => addServiceLine()}
              >
                <Plus /> New service &ldquo;{svcQuery.trim()}&rdquo;
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              onClick={() => addServiceLine()}
            >
              <Plus /> Service
            </Button>
            {lines.length ? (
              <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm tabular-nums">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="text-right">{money(totals.subtotalBeforeCents)}</dd>
                {totals.savingsCents ? (
                  <>
                    <dt className="text-muted-foreground">Discounts</dt>
                    <dd className="text-right">
                      −{money(totals.savingsCents)}
                    </dd>
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
                <dt className="border-t border-border pt-1 text-base font-semibold">
                  Total
                </dt>
                <dd className="border-t border-border pt-1 text-right text-base font-semibold">
                  {money(totals.totalCents)}
                </dd>
              </dl>
            ) : null}
          </section>

          {/* Payment (optional) */}
          <section className="flex flex-col gap-3">
            <h3 className={sectionTitle}>Payment</h3>
            <div className="flex flex-col gap-3">
              <Field id="pay-mode" label="Payment">
                <select
                  id="pay-mode"
                  className={selectClass}
                  value={payMode}
                  onChange={(e) => setPayMode(e.target.value as PayMode)}
                >
                  <option value="later">Pay at pick-up</option>
                  {hasTotal ? (
                    <option value="full">Paid</option>
                  ) : null}
                  <option value="deposit">Deposit</option>
                </select>
              </Field>
              {payMode === "deposit" ? (
                <Field
                  id="deposit"
                  label="Deposit *"
                  hint={
                    hasTotal
                      ? `At most ${money(totals.totalCents)}`
                      : undefined
                  }
                >
                  <MoneyInput
                    id="deposit"
                    value={depositAmount}
                    onValueChange={setDepositAmount}
                  />
                </Field>
              ) : null}
            </div>
          </section>

          {/* Pick-up date (optional) */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className={sectionTitle}>
                Pick-up date{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </h3>
              {promised ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPromised("")}
                >
                  <X /> Clear
                </Button>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {promised
                ? `Ready by ${promisedDisplay}.`
                : "The number on a day is how many open tickets are already due then."}
            </p>
            <Popover open={pickOpen} onOpenChange={setPickOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="justify-start gap-2 font-normal"
                >
                  <CalendarDays />{" "}
                  {promised ? promisedDisplay : "Choose a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <PickupCalendar
                  shopId={shop.id}
                  today={today}
                  value={promised}
                  onChange={(iso) => {
                    setPromised(iso);
                    if (iso) setPickOpen(false);
                  }}
                  className="rounded-none border-0"
                />
              </PopoverContent>
            </Popover>
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
              onChange={(e) =>
                setPhotos([...photos, ...Array.from(e.target.files ?? [])])
              }
            />
            {photos.length ? (
              <p className="text-sm text-muted-foreground">
                {photos.length} photo{photos.length > 1 ? "s" : ""} ready to
                upload (10 MB max each).
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
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
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

function ServiceLine({
  line: l,
  isAdmin,
  taxes,
  today,
  currency,
  onChange,
  onRemove,
}: {
  line: DraftLine;
  isAdmin: boolean;
  taxes: TaxRate[];
  today: string;
  currency: string;
  onChange: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
}) {
  const id = `line-${l.key}`;
  const money = (c: number) => formatMoney(c, currency);
  const catalogDiscount =
    l.item?.discount_type &&
    !l.discount &&
    discountActiveOn(l.item, today)
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
              <p className="text-sm font-medium">
                {l.item.name}
              </p>
              <p className="text-sm text-muted-foreground">
                {money(l.item.price_cents)}
                {l.item.unit === "hour" ? " per hour" : " each"}
                {l.item.tax_rate_ids.length
                  ? ` · ${taxNames(l.item.tax_rate_ids)}`
                  : ""}
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
                  onChange({ discount: { ...l.discount!, value, confirmed: false } })
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
            onClick={() =>
              onChange({ discount: { ...l.discount!, confirmed: true } })
            }
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
              shopId={l.item?.id ?? ""}
              taxes={taxes}
              onCreated={(rate) =>
                onChange({ taxIds: [...(l.taxIds ?? []), rate.id] })
              }
            />
          </div>
        </div>
      ) : null}

      {/* Add buttons: discount on any line (Admin), tax on new services (Admin) */}
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

/** Inline tax creator reused from the catalog form (PR 4): name + rate + ✓. */
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

  async function confirm() {
    if (!name.trim()) return;
    if (!RATE_RE.test(rate.trim())) return;
    setCreating(true);
    const { data, error } = await getSupabase()
      .from("tax_rates")
      .insert({ shop_id: shopId, name: name.trim(), rate: Number(rate) })
      .select("id, name, rate, active")
      .single();
    setCreating(false);
    if (error || !data) return;
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
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="w-20">
        <Input
          aria-label="New tax rate"
          inputMode="decimal"
          value={rate}
          placeholder="13"
          onChange={(e) => setRate(e.target.value)}
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
    </>
  );
}
