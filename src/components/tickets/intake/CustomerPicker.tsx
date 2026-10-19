import { Plus, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Field } from "@/components/app/Field";
import { PhoneInput } from "@/components/app/MaskedInputs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabase } from "@/lib/supabase";

export type Found = { id: string; label: string; since?: string };

export type CustomerDraft = {
  name: string;
  phone: string;
  email: string;
  /** How this customer gets updates; saved on the customer for next time. */
  channel: "sms" | "email";
};
const EMPTY_CUSTOMER: CustomerDraft = { name: "", phone: "", email: "", channel: "sms" };

/**
 * Customer field for the new-ticket dialog (decision 78 redesign): one search
 * box. On focus it lists recent customers (with "Customer since" dates),
 * filters via search_shop on typing, and ends with "Create “<typed>”", which
 * opens a small new-customer panel prefilled from the text. Escape closes only
 * the list, not the whole dialog. "Send updates by" (text or email) is saved
 * on the customer, not the ticket, so it is remembered (decision 82).
 */
export function CustomerPicker({
  shopId,
  timeZone,
  customer,
  onCustomerChange,
  draft,
  onDraftChange,
}: {
  shopId: string;
  timeZone: string;
  customer: Found | null;
  onCustomerChange: (c: Found | null) => void;
  /** The inline "New customer" panel's values, or null when it is closed.
   * The dialog saves the customer when the ticket is created (no separate
   * save step: Oz's test, 16 Oct, typed a customer and it was never saved). */
  draft: CustomerDraft | null;
  onDraftChange: (d: CustomerDraft | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<Found[]>([]);
  const creating = draft !== null;
  const newCust = draft ?? EMPTY_CUSTOMER;
  const setNewCust = (d: CustomerDraft) => onDraftChange(d);
  const setCreating = (on: boolean) => onDraftChange(on ? EMPTY_CUSTOMER : null);
  const searchSeq = useRef(0);
  // Bumped on focus so clicking the field always (re)opens the list.
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const q = query.trim();
    if (customer) {
      setFound([]);
      return;
    }
    const seq = ++searchSeq.current;
    if (q.length >= 2) {
      const timer = setTimeout(async () => {
        const { data } = await getSupabase().rpc("search_shop", {
          p_shop_id: shopId,
          p_query: q,
        });
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
    }
    // Empty query: recent customers with "Customer since" dates.
    void getSupabase()
      .from("customers")
      .select("id, name, created_at")
      .eq("shop_id", shopId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data }) => {
        if (seq !== searchSeq.current) return;
        setFound(
          ((data ?? []) as { id: string; name: string; created_at: string }[]).map((c) => {
            const since = c.created_at
              ? new Intl.DateTimeFormat("en-CA", {
                  month: "short",
                  year: "numeric",
                  timeZone,
                }).format(new Date(c.created_at))
              : undefined;
            return since ? { id: c.id, label: c.name, since } : { id: c.id, label: c.name };
          }),
        );
      });
    return undefined;
  }, [query, customer, shopId, timeZone, reload]);

  async function choose(f: Found) {
    onCustomerChange(f);
    setQuery("");
    setFound([]);
    if (f.since) return;
    // Fetch the exact created_at for the "since" tag in the selected state.
    const { data } = await getSupabase()
      .from("customers")
      .select("created_at")
      .eq("id", f.id)
      .maybeSingle();
    if (data?.created_at) {
      const since = new Intl.DateTimeFormat("en-CA", {
        month: "short",
        year: "numeric",
        timeZone,
      }).format(new Date(data.created_at as string));
      onCustomerChange({ ...f, since });
    }
  }

  // The typed text, offered as a new customer (name, phone or email).
  function startCreate() {
    const q = query.trim();
    setOpen(false);
    onDraftChange({
      ...EMPTY_CUSTOMER,
      name: /\d|@/.test(q) ? "" : q,
      phone: /^[\d\s()+-]+$/.test(q) ? q : "",
      email: q.includes("@") ? q : "",
    });
  }

  return (
    <section className="flex flex-col gap-2">
      {customer ? (
        <>
          <span className="text-sm font-semibold">Customer</span>
          <div className="flex items-center gap-3 rounded-xl border border-input bg-surface-2 py-2 pr-1 pl-3">
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-1 text-sm font-semibold"
            >
              {initials(customer.label)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{customer.label}</p>
              {customer.since ? (
                <p className="text-sm text-muted-foreground">Customer since {customer.since}</p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              className="underline underline-offset-4"
              onClick={() => {
                onCustomerChange(null);
                setQuery("");
              }}
            >
              Change
            </Button>
          </div>
        </>
      ) : creating ? (
        <>
          <span className="text-sm font-semibold">Customer</span>
          <div className="flex flex-col gap-3 rounded-xl border border-input bg-surface-1 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">New customer</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="underline underline-offset-4"
                onClick={() => setCreating(false)}
              >
                Back to search
              </Button>
            </div>
            <Field id="nc-name" label="Name">
              <Input
                id="nc-name"
                value={newCust.name}
                onChange={(e) => setNewCust({ ...newCust, name: e.target.value })}
                maxLength={120}
                autoFocus
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="nc-phone" label="Mobile phone">
                <PhoneInput
                  id="nc-phone"
                  value={newCust.phone}
                  onValueChange={(phone) => setNewCust({ ...newCust, phone })}
                />
              </Field>
              <Field id="nc-email" label="Email">
                <Input
                  id="nc-email"
                  type="email"
                  placeholder="name@example.com"
                  value={newCust.email}
                  onChange={(e) => setNewCust({ ...newCust, email: e.target.value })}
                />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span id="nc-channel-label" className="text-sm">
                Send updates by
              </span>
              <div
                role="group"
                aria-labelledby="nc-channel-label"
                className="flex overflow-hidden rounded-xl border border-input"
              >
                {(["sms", "email"] as const).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    aria-pressed={newCust.channel === ch}
                    onClick={() => setNewCust({ ...newCust, channel: ch })}
                    className={
                      newCust.channel === ch
                        ? "h-11 bg-primary px-4 font-semibold text-primary-foreground"
                        : "h-11 bg-surface-2 px-4 hover:bg-accent"
                    }
                  >
                    {ch === "sms" ? "Text" : "Email"}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Saved with the ticket. A phone number, an email, or both.
            </p>
          </div>
        </>
      ) : (
        <>
          <label htmlFor="cust-search" className="text-sm font-semibold">
            Customer
          </label>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="cust-search"
              className="pl-9"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => {
                setOpen(true);
                setReload((r) => r + 1);
              }}
              onClick={() => setOpen(true)}
              onBlur={() => setOpen(false)}
              onKeyDown={(e) => {
                // Escape closes only the list; the dialog checks for an open
                // list (data-picker-list) before closing itself.
                if (e.key === "Escape") setOpen(false);
                // Enter picks the first match, or starts a new customer.
                if (e.key === "Enter") {
                  e.preventDefault();
                  const first = found[0];
                  if (first && query.trim()) {
                    setOpen(false);
                    void choose(first);
                  } else if (query.trim()) startCreate();
                }
              }}
              placeholder="Search by name, phone or email"
              autoFocus
              autoComplete="off"
              aria-expanded={open}
            />
            {open ? (
              <ul
                data-picker-list
                className="absolute inset-x-0 top-full z-10 mt-1 max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-input bg-surface-2 shadow-lg ring-1 ring-black/5"
              >
                {found.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      className="flex min-h-11 w-full flex-col justify-center px-4 py-1 text-left hover:bg-accent"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setOpen(false);
                        void choose(f);
                      }}
                    >
                      <span>{f.label}</span>
                      {f.since ? (
                        <span className="text-xs text-muted-foreground">
                          Customer since {f.since}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center gap-2 px-4 text-left font-semibold hover:bg-accent"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      startCreate();
                    }}
                  >
                    <Plus aria-hidden className="size-4" />
                    {query.trim() ? <>Create &ldquo;{query.trim()}&rdquo;</> : "New customer"}
                  </button>
                </li>
              </ul>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")
  ).toUpperCase();
}
