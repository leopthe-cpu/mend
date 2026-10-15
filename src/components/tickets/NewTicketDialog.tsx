import { useNavigate } from "@tanstack/react-router";
import { CalendarDays, Camera, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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
  type DiscountType,
  fetchCatalog,
  fetchTaxRates,
  formatMoney,
  parseMoney,
  parseQuantity,
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
import { CustomFieldInput } from "../CustomFieldInput";
import { PickupCalendar } from "../PickupCalendar";
import { CustomerPicker, type Found } from "./intake/CustomerPicker";
import { PaymentField, type PayMode } from "./intake/PaymentField";
import { ServiceLine, type Discount, type DraftLine } from "./intake/ServiceLine";

let lineSeq = 0;

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

  const [customer, setCustomer] = useState<Found | null>(null);

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

  function reset() {
    setCustomer(null);
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
        name: item?.name ?? svcQuery.trim(),
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
    const missing = focusFirstMissingField([
      {
        id: customer ? "cust-selected" : "cust-search",
        ok: !!customer,
        message: "Choose a customer or add a new one.",
      },
      { id: "issue", ok: !!issue.trim(), message: "Describe what needs doing." },
    ]);
    if (missing) {
      setError(missing.message);
      return;
    }
    for (const f of detailFields) {
      if (f.required && (custom[f.id] === undefined || custom[f.id] === "")) {
        setError(`${f.label} is required.`);
        document.getElementById(`cf-${f.id}`)?.focus();
        return;
      }
    }
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
        // Discount opened but value empty — not confirmed, skip.
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
      if (!customerId) throw new Error("no customer");
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
          <CustomerPicker
            shopId={shop.id}
            timeZone={shop.time_zone}
            customer={customer}
            onCustomerChange={setCustomer}
          />

          {/* Description & details */}
          <section className="flex flex-col gap-4">
            <Field id="issue" label="Description *">
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
                      onChange={(v) => {
                        setCustom({ ...custom, [f.id]: v });
                        setError(null);
                      }}
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
                    shopId={shop.id}
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
                  catalog.length
                    ? "Search the catalog or type a new name"
                    : "The catalog is empty"
                }
                disabled={!catalog.length && !isAdmin}
                autoComplete="off"
              />
              {svcOpen && svcMatches.length ? (
                <ul
                  className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border bg-background shadow-md"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setSvcOpen(false);
                    }
                  }}
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
            <PaymentField
              payMode={payMode}
              onPayModeChange={setPayMode}
              depositAmount={depositAmount}
              onDepositAmountChange={(v) => {
                setDepositAmount(v);
                setError(null);
              }}
              hasTotal={hasTotal}
              total={totals.totalCents}
              currency={shop.currency}
            />
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
