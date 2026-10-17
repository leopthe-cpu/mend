import { useNavigate } from "@tanstack/react-router";
import { Camera, Check, ChevronRight, Pencil, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { Field, selectClass } from "@/components/app/Field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { focusFirstMissingField } from "@/lib/form";
import { previewTotals, type PreviewLine } from "@/lib/intake";
import {
  type CatalogItem,
  fetchCatalog,
  fetchTaxRates,
  formatMoney,
  parseMoney,
  parseQuantity,
  discountActiveOn,
  type TaxRate,
} from "@/lib/money";
import { friendlyDbError, roleAtLeast, type Membership } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import { parseTicketDiscount, type TicketDiscountDraft } from "@/lib/ticketDiscount";
import {
  fetchCustomFields,
  fetchMembers,
  shopToday,
  uploadPhotos,
  type CustomField,
  type Member,
} from "@/lib/tickets";
import { CustomFieldInput } from "./CustomFieldInput";
import { TicketDiscountInput } from "./TicketDiscountInput";
import { CustomerPicker, type CustomerDraft, type Found } from "./intake/CustomerPicker";
import { PaymentField, type PayMode } from "./intake/PaymentField";
import { ReadyByField } from "./intake/ReadyByField";
import { ServiceLine, type DraftLine } from "./intake/ServiceLine";

// New-ticket form, redesigned after Oz's production test (16 Oct, decision 78):
// one customer search with "Create", no title (the database makes one from the
// description), compact service rows, one whole-ticket discount (Admins),
// payment and "Ready by" as buttons, assigned to the creator by default,
// optional details folded under "More details", and a bottom bar that keeps
// the total and Create in view. On phones it is full screen.

let lineSeq = 0;

function linePayload(l: DraftLine) {
  const qty = parseQuantity(l.qty) ?? 1;
  // A $0 catalog item (like the seeded "Labor") can be priced on the ticket by
  // an Admin; the database checks the role (decision 80).
  const price = parseMoney(l.price);
  return l.item
    ? {
        catalog_item_id: l.item.id,
        quantity: qty,
        ...(l.item.price_cents === 0 && price ? { price_cents: price } : {}),
      }
    : {
        name: l.name.trim(),
        quantity: qty,
        price_cents: parseMoney(l.price) ?? 0,
        tax_rate_ids: l.taxIds ?? [],
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
  const [myId, setMyId] = useState<string | null>(null);

  const [customer, setCustomer] = useState<Found | null>(null);
  const [customerDraft, setCustomerDraft] = useState<CustomerDraft | null>(null);

  const [issue, setIssue] = useState("");
  const [custom, setCustom] = useState<Record<string, string | number | undefined>>({});

  const [lines, setLines] = useState<DraftLine[]>([]);
  const [svcQuery, setSvcQuery] = useState("");
  const [svcOpen, setSvcOpen] = useState(false);
  const [discount, setDiscount] = useState<TicketDiscountDraft | null>(null);
  // The discount row locks once filled in (Enter, ✓ or clicking away); the
  // pencil opens it again (decision 82).
  const [discountLocked, setDiscountLocked] = useState(false);

  const [promised, setPromised] = useState("");
  const [assignee, setAssignee] = useState("");
  const [assigneeTouched, setAssigneeTouched] = useState(false);
  const [payMode, setPayMode] = useState<PayMode>("later");
  const [depositAmount, setDepositAmount] = useState("");
  const [passcode, setPasscode] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [terms, setTerms] = useState(false);
  // PR 8 (decision 72): consent to ticket updates, stored on the ticket. When
  // ticked, the database also sends the "Ticket created" message.
  const [updates, setUpdates] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    void getSupabase()
      .auth.getSession()
      .then(({ data }) => setMyId(data.session?.user.id ?? null));
  }, [open, shop.id]);

  // Assigned to the person creating the ticket unless they pick someone else.
  useEffect(() => {
    if (!assigneeTouched && myId && members.some((m) => m.user_id === myId)) setAssignee(myId);
  }, [assigneeTouched, myId, members]);

  function reset() {
    setCustomer(null);
    setCustomerDraft(null);
    setIssue("");
    setCustom({});
    setLines([]);
    setSvcQuery("");
    setDiscount(null);
    setPromised("");
    setAssigneeTouched(false);
    setPayMode("later");
    setDepositAmount("");
    setPasscode("");
    setPhotos([]);
    setMoreOpen(false);
    setDiscountLocked(false);
    setTerms(false);
    setUpdates(true);
    setError(null);
  }

  const requiredFields = fields.filter((f) => f.required);
  const isElectronics = shop.vertical === "electronics";

  const svcMatches = useMemo(() => {
    const q = svcQuery.trim().toLowerCase();
    return catalog.filter((i) => !q || i.name.toLowerCase().includes(q)).slice(0, 8);
  }, [catalog, svcQuery]);
  const svcExact = catalog.some(
    (i) => i.name.trim().toLowerCase() === svcQuery.trim().toLowerCase(),
  );

  function previewLine(l: DraftLine): PreviewLine {
    const qty = parseQuantity(l.qty) ?? 0;
    if (l.item) {
      const catalogDiscount =
        l.item.discount_type && discountActiveOn(l.item, today)
          ? { type: l.item.discount_type, value: l.item.discount_value ?? 0 }
          : null;
      return {
        quantity: qty,
        unitPriceCents: l.item.price_cents === 0 ? (parseMoney(l.price) ?? 0) : l.item.price_cents,
        discount: catalogDiscount,
        taxRateIds: l.item.tax_rate_ids,
      };
    }
    return {
      quantity: qty,
      unitPriceCents: parseMoney(l.price) ?? 0,
      discount: null,
      taxRateIds: l.taxIds ?? [],
    };
  }
  // The discount only counts once it is valid and there are services to take it off.
  const discountOn = isAdmin && lines.length > 0 && discount !== null;
  const parsedDiscount = discountOn ? parseTicketDiscount(discount) : null;
  const totals = previewTotals(
    lines.map(previewLine),
    taxes,
    parsedDiscount?.ok ? { type: parsedDiscount.type, value: parsedDiscount.value } : null,
  );
  const lineSavings = totals.savingsCents - totals.ticketDiscountCents;
  const hasTotal = totals.totalCents > 0;
  const depositCents = parseMoney(depositAmount) ?? 0;

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setError(null);
  }

  function addServiceLine(item?: CatalogItem) {
    setLines((ls) => [
      ...ls,
      {
        key: `l${++lineSeq}`,
        item: item ?? null,
        name: item?.name ?? svcQuery.trim(),
        qty: "1",
        price: "",
        taxIds: null,
      },
    ]);
    setSvcQuery("");
    setSvcOpen(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const draft = !customer ? customerDraft : null;
    const missing = focusFirstMissingField([
      ...(draft
        ? [
            { id: "nc-name", ok: !!draft.name.trim(), message: "Enter the customer's name." },
            {
              id: "nc-phone",
              ok: !!(draft.phone.trim() || draft.email.trim()),
              message: "Enter the customer's phone number or email.",
            },
          ]
        : [{ id: "cust-search", ok: !!customer, message: "Choose a customer or add a new one." }]),
      { id: "issue", ok: !!issue.trim(), message: "Describe what needs doing." },
      ...requiredFields.map((f) => ({
        id: `cf-${f.id}`,
        ok: custom[f.id] !== undefined && custom[f.id] !== "",
        message: `${f.label} is required.`,
      })),
      ...lines.flatMap((l, i) => {
        const label = l.item?.name || l.name.trim() || `Service ${i + 1}`;
        return [
          ...(l.item
            ? []
            : [
                {
                  id: `line-${l.key}-name`,
                  ok: !!l.name.trim(),
                  message: `Service ${i + 1}: enter what it's for.`,
                },
                {
                  id: `line-${l.key}-price`,
                  ok: parseMoney(l.price) !== null,
                  message: `${label}: enter a price.`,
                },
              ]),
          {
            id: `line-${l.key}-qty`,
            ok: !!parseQuantity(l.qty),
            message: `${label}: enter a quantity, for example 1 or 1.5.`,
          },
        ];
      }),
      ...(parsedDiscount && !parsedDiscount.ok
        ? [{ id: "ticket-discount", ok: false, message: parsedDiscount.message }]
        : []),
      ...(payMode === "deposit"
        ? [
            { id: "deposit", ok: depositCents > 0, message: "Enter the deposit amount." },
            {
              id: "deposit",
              ok: !hasTotal || depositCents <= totals.totalCents,
              message: `The deposit can't be more than the total (${money(totals.totalCents)}).`,
            },
          ]
        : []),
    ]);
    if (missing) {
      setError(missing.message);
      return;
    }
    if (parsedDiscount?.ok && totals.subtotalBeforeCents - lineSavings === 0) {
      setError(
        "The services have no price yet, so there's nothing to discount. Add a price or remove the discount.",
      );
      document.getElementById("ticket-discount")?.focus();
      return;
    }
    if (
      parsedDiscount?.ok &&
      parsedDiscount.type === "fixed" &&
      totals.ticketDiscountCents < Math.round(parsedDiscount.value * 100)
    ) {
      setError(
        `The discount can't be more than the services (${money(totals.subtotalBeforeCents - lineSavings)}).`,
      );
      document.getElementById("ticket-discount")?.focus();
      return;
    }
    if (payMode === "full" && !hasTotal) {
      setError("Add a price before marking it paid.");
      return;
    }
    if (shop.terms_text && !terms) {
      setError("The customer needs to accept the terms.");
      document.getElementById("terms")?.focus();
      return;
    }

    setSaving(true);
    try {
      const sb = getSupabase();
      let customerId = customer?.id;
      if (!customerId && draft) {
        // Save the customer typed in the inline panel first. Keep it selected,
        // so a retry after a ticket error doesn't create a duplicate.
        const { data: newId, error: custError } = await sb.rpc("save_customer", {
          p_shop_id: shop.id,
          p_customer_id: null,
          p_name: draft.name.trim(),
          p_phone: draft.phone.trim() || null,
          p_email: draft.email.trim() || null,
          p_preferred_channel: draft.channel,
          p_notes: null,
        });
        if (custError) throw custError;
        customerId = newId as string;
        setCustomer({ id: customerId, label: draft.name.trim() });
        setCustomerDraft(null);
      }
      if (!customerId) throw new Error("no customer");
      const cleanCustom = Object.fromEntries(
        Object.entries(custom).filter(
          ([id, v]) => v !== undefined && v !== "" && fields.some((f) => f.id === id),
        ),
      );
      const { data, error } = await sb.rpc("create_ticket_full", {
        p_shop_id: shop.id,
        p_customer_id: customerId,
        p_issue_description: issue,
        p_item_name: null,
        p_promised_date: promised || null,
        p_assigned_to: assignee || null,
        p_custom_fields: cleanCustom,
        p_passcode: passcode || null,
        p_terms_accepted: terms,
        p_updates_consent: updates,
        p_lines: lines.map(linePayload),
        p_payment:
          payMode === "full"
            ? { full: true }
            : payMode === "deposit"
              ? { amount_cents: depositCents }
              : null,
        p_discount: parsedDiscount?.ok
          ? { type: parsedDiscount.type, value: parsedDiscount.value }
          : null,
      });
      if (error) throw error;
      const created = (data as { ticket_id: string; ticket_number: number }[])[0];
      if (!created) throw new Error("no ticket");
      const problems = photos.length ? await uploadPhotos(shop.id, created.ticket_id, photos) : [];
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

  const payNote =
    payMode === "full"
      ? "Total incl. tax · paid"
      : payMode === "deposit" && depositCents > 0
        ? `Total incl. tax · ${money(depositCents)} deposit`
        : "Total incl. tax";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-svh max-h-svh w-full max-w-none flex-col gap-0 rounded-none border-0 bg-background p-0 text-foreground sm:h-auto sm:max-h-[92svh] sm:max-w-2xl sm:rounded-lg sm:border"
        // Escape with a customer or service list open closes that list only,
        // not the whole form (and everything typed into it).
        onEscapeKeyDown={(e) => {
          if (document.querySelector("[data-picker-list]")) e.preventDefault();
        }}
      >
        <DialogHeader className="border-b border-border px-4 py-4 text-left sm:px-6">
          <DialogTitle className="text-xl sm:text-2xl">New ticket</DialogTitle>
          <DialogDescription className="sr-only">
            Only the customer and what needs doing are required.
          </DialogDescription>
        </DialogHeader>
        <form
          method="post"
          onSubmit={save}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          // Enter in a text field adds that row or picks from a list (handled
          // by the field); it never creates the ticket. Create does (Oz, 16 Oct).
          onKeyDown={(e) => {
            const t = e.target as HTMLInputElement;
            if (e.key === "Enter" && t.tagName === "INPUT" && t.type !== "checkbox")
              e.preventDefault();
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-7 overflow-y-auto px-4 py-5 sm:px-6">
            <CustomerPicker
              shopId={shop.id}
              timeZone={shop.time_zone}
              customer={customer}
              onCustomerChange={setCustomer}
              draft={customerDraft}
              onDraftChange={setCustomerDraft}
            />

            <section className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label htmlFor="issue" className="text-sm font-semibold">
                  What needs doing
                </label>
                <Textarea
                  id="issue"
                  value={issue}
                  onChange={(e) => {
                    setIssue(e.target.value);
                    setError(null);
                  }}
                  rows={3}
                  maxLength={4000}
                  placeholder="What the customer brought in and what needs doing"
                  className="bg-surface-2 text-base"
                />
              </div>
              {requiredFields.map((f) => (
                <Field key={f.id} id={`cf-${f.id}`} label={f.label} hint={f.help_text}>
                  <CustomFieldInput
                    id={`cf-${f.id}`}
                    field={f}
                    value={custom[f.id]}
                    onChange={(v) => {
                      setCustom({ ...custom, [f.id]: v });
                      setError(null);
                    }}
                  />
                </Field>
              ))}
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

            {/* Services */}
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold">Services</h3>
              <div className="relative">
                <Plus
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  className="pl-9"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setSvcOpen(false);
                    if (e.key === "Enter") {
                      // Enter adds the best match, or a new service (Admins).
                      const q = svcQuery.trim().toLowerCase();
                      const match =
                        catalog.find((i) => i.name.trim().toLowerCase() === q) ??
                        (q ? svcMatches[0] : undefined);
                      if (match) addServiceLine(match);
                      else if (isAdmin && q) addServiceLine();
                    }
                  }}
                  onClick={() => setSvcOpen(true)}
                  aria-label="Add a service"
                  value={svcQuery}
                  onChange={(e) => {
                    setSvcQuery(e.target.value);
                    setSvcOpen(true);
                  }}
                  onFocus={() => setSvcOpen(true)}
                  onBlur={() => {
                    setSvcOpen(false);
                    // A typed name is kept when focus leaves the field, instead
                    // of being silently dropped: an exact catalog match adds that
                    // item; otherwise an Admin gets a new-service row.
                    const q = svcQuery.trim().toLowerCase();
                    if (!q) return;
                    const match = catalog.find((i) => i.name.trim().toLowerCase() === q);
                    if (match) addServiceLine(match);
                    else if (isAdmin) addServiceLine();
                  }}
                  placeholder={
                    catalog.length
                      ? "Add a service: search the catalog"
                      : isAdmin
                        ? "Add a service: type its name"
                        : "The catalog is empty"
                  }
                  disabled={!catalog.length && !isAdmin}
                  autoComplete="off"
                />
                {svcOpen && (svcMatches.length || isAdmin) ? (
                  <ul
                    data-picker-list
                    className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-input bg-surface-2 shadow-lg ring-1 ring-black/5"
                  >
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
                    {isAdmin && !svcExact ? (
                      <li>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            addServiceLine();
                          }}
                          className="flex min-h-11 w-full items-center gap-2 px-4 text-left font-semibold hover:bg-accent"
                        >
                          <Plus aria-hidden className="size-4" />
                          {svcQuery.trim() ? (
                            <>New service &ldquo;{svcQuery.trim()}&rdquo;</>
                          ) : (
                            "New service (not in the catalog)"
                          )}
                        </button>
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </div>

              {lines.length ? (
                <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                  {lines.map((l) => (
                    <ServiceLine
                      key={l.key}
                      line={l}
                      isAdmin={isAdmin}
                      shopId={shop.id}
                      taxes={taxes}
                      today={today}
                      currency={shop.currency}
                      totalCents={
                        previewTotals([{ ...previewLine(l), taxRateIds: [] }], []).subtotalCents
                      }
                      onChange={(patch) => updateLine(l.key, patch)}
                      onRemove={() => setLines(lines.filter((x) => x.key !== l.key))}
                      onTaxCreated={(rate) => setTaxes((ts) => [...ts, rate])}
                    />
                  ))}
                </ul>
              ) : null}

              {/* Whole-ticket discount (decision 78): Owner/Admin. */}
              {isAdmin && lines.length ? (
                discount && discountLocked && parsedDiscount?.ok ? (
                  <div className="flex items-center gap-2 rounded-md bg-surface-1 py-1 pr-1 pl-3">
                    <span className="flex-1">
                      Discount{" "}
                      {parsedDiscount.type === "percent"
                        ? `${parsedDiscount.value}%`
                        : money(Math.round(parsedDiscount.value * 100))}
                    </span>
                    <span className="tabular-nums">−{money(totals.ticketDiscountCents)}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      aria-label="Edit discount"
                      onClick={() => setDiscountLocked(false)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      aria-label="Remove discount"
                      onClick={() => setDiscount(null)}
                    >
                      <X />
                    </Button>
                  </div>
                ) : discount ? (
                  <div
                    className="flex flex-wrap items-center gap-3 rounded-md bg-surface-1 px-3 py-2"
                    onBlur={(e) => {
                      if (
                        parsedDiscount?.ok &&
                        !e.currentTarget.contains(e.relatedTarget as Node | null)
                      )
                        setDiscountLocked(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && parsedDiscount?.ok) setDiscountLocked(true);
                    }}
                  >
                    <span className="flex-1 text-sm font-semibold">
                      Discount on the whole ticket
                    </span>
                    <TicketDiscountInput
                      id="ticket-discount"
                      draft={discount}
                      onChange={(d) => {
                        setDiscount(d);
                        setError(null);
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-11"
                      aria-label="Done with discount"
                      disabled={!parsedDiscount?.ok}
                      onClick={() => setDiscountLocked(true)}
                    >
                      <Check />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      aria-label="Remove discount"
                      onClick={() => setDiscount(null)}
                    >
                      <X />
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    className="self-start underline underline-offset-4"
                    onClick={() => {
                      setDiscount({ type: "percent", value: "" });
                      setDiscountLocked(false);
                    }}
                  >
                    Add discount
                  </Button>
                )
              ) : null}

              {lines.length ? (
                <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm tabular-nums">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="text-right">{money(totals.subtotalBeforeCents)}</dd>
                  {lineSavings ? (
                    <>
                      <dt className="text-muted-foreground">Catalog discounts</dt>
                      <dd className="text-right">−{money(lineSavings)}</dd>
                    </>
                  ) : null}
                  {totals.ticketDiscountCents ? (
                    <>
                      <dt className="text-muted-foreground">Ticket discount</dt>
                      <dd className="text-right">−{money(totals.ticketDiscountCents)}</dd>
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
                </dl>
              ) : null}
            </section>

            <PaymentField
              payMode={payMode}
              onPayModeChange={(m) => {
                setPayMode(m);
                setError(null);
              }}
              depositAmount={depositAmount}
              onDepositAmountChange={(v) => {
                setDepositAmount(v);
                setError(null);
              }}
              depositCents={depositCents}
              hasTotal={hasTotal}
              total={totals.totalCents}
              currency={shop.currency}
            />

            <ReadyByField
              shopId={shop.id}
              today={today}
              timeZone={shop.time_zone}
              schedule={shop.business_hours?.schedule}
              value={promised}
              onChange={setPromised}
            />

            <div className="flex flex-col gap-2 sm:max-w-xs">
              <label htmlFor="assignee" className="text-sm font-semibold">
                Assigned to
              </label>
              <select
                id="assignee"
                className={selectClass}
                value={assignee}
                onChange={(e) => {
                  setAssignee(e.target.value);
                  setAssigneeTouched(true);
                }}
              >
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.user_id === myId ? `Me (${m.name || m.email})` : m.name || m.email}
                  </option>
                ))}
                <option value="">Nobody yet</option>
              </select>
            </div>

            {/* Photos (decision 82): photos show colour, brand and condition, so the
                optional detail fields left this form; they stay on the ticket page. */}
            <section className="flex flex-col gap-3 border-t border-border pt-3">
              <button
                type="button"
                aria-expanded={moreOpen}
                aria-controls="photos-section"
                onClick={() => setMoreOpen(!moreOpen)}
                className="flex min-h-11 items-center gap-3 text-left"
              >
                <ChevronRight
                  aria-hidden
                  className={`size-5 shrink-0 transition-transform motion-reduce:transition-none ${moreOpen ? "rotate-90" : ""}`}
                />
                <span className="font-semibold">Photos</span>
                <span className="text-sm text-muted-foreground">
                  {photos.length
                    ? `${photos.length} added`
                    : "Optional: the item's condition, colour, brand"}
                </span>
              </button>
              <div id="photos-section" hidden={!moreOpen} className="flex flex-col gap-2">
                <label
                  htmlFor="photos"
                  className="inline-flex h-11 w-fit cursor-pointer items-center gap-2 rounded-md border border-input px-4 font-medium hover:bg-accent"
                >
                  <Camera className="size-5" aria-hidden /> Add photos
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
              </div>
            </section>

            {/* Updates consent */}
            <label className="flex min-h-11 items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 size-5 shrink-0"
                checked={updates}
                onChange={(e) => setUpdates(e.target.checked)}
              />
              <span>The customer agrees to get updates about this ticket by text or email</span>
            </label>

            {/* Terms */}
            {shop.terms_text ? (
              <section className="flex flex-col gap-2 rounded-md border border-border bg-card p-4">
                <p className="max-h-28 overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground">
                  {shop.terms_text}
                </p>
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    id="terms"
                    type="checkbox"
                    className="size-5"
                    checked={terms}
                    onChange={(e) => setTerms(e.target.checked)}
                  />
                  <span>The customer accepts these terms</span>
                </label>
              </section>
            ) : null}
          </div>

          {/* Bottom bar: always in view, with the total and Create. */}
          <div className="flex flex-col gap-3 border-t border-border bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
            {error ? <FormAlert tone="error">{error}</FormAlert> : null}
            <div className="flex items-center gap-3">
              <div className="flex min-w-0 flex-1 flex-col">
                {lines.length ? (
                  <>
                    <span className="text-xs text-muted-foreground">{payNote}</span>
                    <span className="text-xl font-bold tabular-nums">
                      {money(totals.totalCents)}
                    </span>
                  </>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                className="hidden sm:inline-flex"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={saving}>
                {saving ? "Creating…" : "Create ticket"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
