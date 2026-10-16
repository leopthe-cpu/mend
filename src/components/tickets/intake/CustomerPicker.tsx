import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Field, selectClass } from "@/components/app/Field";
import { PhoneInput } from "@/components/app/MaskedInputs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabase } from "@/lib/supabase";

export type Found = { id: string; label: string; since?: string };

export type CustomerDraft = {
  name: string;
  phone: string;
  email: string;
  channel: "sms" | "email";
};
const EMPTY_CUSTOMER: CustomerDraft = { name: "", phone: "", email: "", channel: "sms" };

/**
 * Customer field for the new-ticket dialog (PR 6b): opens recent customers on
 * focus (with "Customer since" dates), filters via search_shop on typing, and
 * includes a "+ Customer" button that opens a new-customer panel in a tinted
 * panel.  Escape closes only the list, not the whole dialog.
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

  const sectionTitle = "text-base font-semibold";

  return (
    <section className="flex flex-col gap-3">
      {customer ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Customer *</span>
          <div className="flex items-center justify-between gap-3 rounded-md border border-input bg-surface-2 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{customer.label}</p>
              {customer.since ? (
                <p className="text-sm text-muted-foreground">Customer since {customer.since}</p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onCustomerChange(null);
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
            <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)}>
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
            <div className="relative min-w-0 flex-1">
              <Input
                id="cust-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => setReload((r) => r + 1)}
                onClick={() => setReload((r) => r + 1)}
                onKeyDown={(e) => {
                  // Escape closes only the list; the dialog checks for an open
                  // list (data-picker-list) before closing itself.
                  if (e.key === "Escape") setFound([]);
                }}
                placeholder="Name, phone or email"
                autoFocus
                autoComplete="off"
              />
              {found.length ? (
                <ul
                  data-picker-list
                  className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border bg-background shadow-md"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setFound([]);
                    }
                  }}
                >
                  {found.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        className="flex min-h-11 w-full flex-col justify-center px-4 text-left hover:bg-accent"
                        onMouseDown={(e) => {
                          e.preventDefault();
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
  );
}
