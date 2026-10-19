import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MessageSquare, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { PageHeader } from "@/components/app/EmptyState";
import { FilterBar, ValueChip, type FilterOption } from "@/components/app/FilterBar";
import { NewCustomerForm, type NewCustomerValues } from "@/components/customers/NewCustomerForm";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { friendlyDbError } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import { fetchContacts, type Customer } from "@/lib/tickets";

type Stats = { repairs_done: number; open_tickets: number; last_ticket_at: string | null };

const FILTERS: FilterOption[] = [
  { id: "flag:open", group: "Show", label: "With open tickets" },
  { id: "flag:sms-off", group: "Show", label: "Texts turned off" },
  { id: "prefers:sms", group: "Prefers", label: "Text" },
  { id: "prefers:email", group: "Prefers", label: "Email" },
];

export const Route = createFileRoute("/app/customers/")({
  head: () => ({ meta: [{ title: "Customers · Mend" }] }),
  component: CustomerList,
});

function CustomerList() {
  const { membership } = Route.useRouteContext();
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [contacts, setContacts] = useState<
    Map<string, { phone: string | null; email: string | null }>
  >(new Map());
  const [stats, setStats] = useState<Map<string, Stats>>(new Map());
  const [filter, setFilter] = useState("");
  // FilterBar ids: "flag:open", "flag:sms-off", "prefers:sms", "prefers:email".
  const [active, setActive] = useState<string[]>([]);
  const toggle = (id: string) =>
    setActive((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from("customers")
      .select("id, name, preferred_channel, sms_opted_out, email_opted_out, notes, created_at")
      .eq("shop_id", membership.shop.id)
      .is("archived_at", null)
      .order("name")
      .limit(500);
    if (error) return setError(friendlyDbError(error));
    const list = (data ?? []) as Customer[];
    setCustomers(list);
    try {
      const [ct, st] = await Promise.all([
        fetchContacts(list.map((c) => c.id)),
        getSupabase()
          .from("customer_stats")
          .select("customer_id, repairs_done, open_tickets, last_ticket_at")
          .eq("shop_id", membership.shop.id),
      ]);
      if (st.error) throw st.error;
      setContacts(ct);
      setStats(
        new Map(
          ((st.data ?? []) as (Stats & { customer_id: string })[]).map((r) => [
            r.customer_id,
            {
              repairs_done: Number(r.repairs_done),
              open_tickets: Number(r.open_tickets),
              last_ticket_at: r.last_ticket_at,
            },
          ]),
        ),
      );
    } catch (e) {
      setError(friendlyDbError(e));
    }
  }, [membership.shop.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    const prefers = active.filter((a) => a.startsWith("prefers:")).map((a) => a.slice(8));
    return customers.filter((c) => {
      const ct = contacts.get(c.id);
      if (prefers.length && !prefers.includes(c.preferred_channel)) return false;
      if (active.includes("flag:open") && !(stats.get(c.id)?.open_tickets ?? 0)) return false;
      if (active.includes("flag:sms-off") && !c.sms_opted_out) return false;
      return (
        !q ||
        c.name.toLowerCase().includes(q) ||
        (!!ct?.email && ct.email.includes(q)) ||
        (digits.length >= 3 && !!ct?.phone && ct.phone.includes(digits))
      );
    });
  }, [customers, contacts, stats, filter, active]);

  const since = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", {
      month: "short",
      year: "numeric",
      timeZone: membership.shop.time_zone,
    }).format(new Date(iso));

  async function createCustomer(values: NewCustomerValues) {
    const { error } = await getSupabase().rpc("save_customer", {
      p_shop_id: membership.shop.id,
      p_customer_id: null,
      p_name: values.name,
      p_phone: values.phone || null,
      p_email: values.email || null,
      p_preferred_channel: values.channel,
      p_notes: null,
    });
    if (error) throw error;
    await load();
    setCreating(false);
  }

  return (
    <>
      <PageHeader title="Customers">
        <Button variant="outline" onClick={() => setCreating(true)}>
          <Plus /> Customer
        </Button>
      </PageHeader>
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      <FilterBar
        options={FILTERS}
        active={active}
        onToggle={toggle}
        text={filter}
        onText={setFilter}
        placeholder="Search or filter: name, phone, email, open tickets…"
      />
      <div className="overflow-x-auto rounded-lg bg-card">
        <table className="w-full text-left">
          <thead className="border-b border-border text-sm text-muted-foreground">
            <tr>
              <th className="px-3 py-3 font-medium">Name</th>
              <th className="px-3 py-3 font-medium">Phone</th>
              <th className="px-3 py-3 font-medium">Email</th>
              <th className="px-3 py-3 font-medium">Customer since</th>
              <th className="px-3 py-3 text-right font-medium">Repairs</th>
              <th className="px-3 py-3 text-right font-medium">Open</th>
              <th className="px-3 py-3 font-medium">Prefers</th>
              <th className="px-3 py-3 font-medium">
                <span className="sr-only">Message</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((c) => (
              <tr
                key={c.id}
                role="link"
                tabIndex={0}
                className="cursor-pointer hover:bg-accent/40"
                onClick={() =>
                  void navigate({
                    to: "/app/customers/$customerId",
                    params: { customerId: c.id },
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    void navigate({
                      to: "/app/customers/$customerId",
                      params: { customerId: c.id },
                    });
                  }
                }}
              >
                <td className="px-3 py-3 font-medium">{c.name}</td>
                <td className="px-3 py-3 font-mono text-sm">{contacts.get(c.id)?.phone ?? ""}</td>
                <td className="px-3 py-3">{contacts.get(c.id)?.email ?? ""}</td>
                <td className="px-3 py-3 whitespace-nowrap">{since(c.created_at)}</td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {stats.get(c.id)?.repairs_done ?? 0}
                </td>
                <td className="px-3 py-3 text-right">
                  {stats.get(c.id)?.open_tickets ? (
                    <ValueChip
                      label={String(stats.get(c.id)?.open_tickets)}
                      pressed={active.includes("flag:open")}
                      onClick={() => toggle("flag:open")}
                    />
                  ) : (
                    <span className="text-muted-foreground tabular-nums">0</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <ValueChip
                    label={
                      (c.preferred_channel === "sms" ? "Text" : "Email") +
                      ((c.preferred_channel === "sms" ? c.sms_opted_out : c.email_opted_out)
                        ? " (opted out)"
                        : "")
                    }
                    pressed={active.includes(`prefers:${c.preferred_channel}`)}
                    onClick={() => toggle(`prefers:${c.preferred_channel}`)}
                  />
                </td>
                <td className="px-3 py-2">
                  {/* Opens this customer's conversation (19 Oct feedback, item 9). */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      void navigate({ to: "/app/messages", search: { customer: c.id } });
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <MessageSquare aria-hidden /> Message
                  </Button>
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-muted-foreground">
                  {customers.length
                    ? "No customers match."
                    : "Add your first customer with “+ Customer”."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[92svh] overflow-y-auto bg-background text-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl">New customer</DialogTitle>
            <DialogDescription>Add a name and a phone or email.</DialogDescription>
          </DialogHeader>
          <NewCustomerForm idPrefix="nc" onSubmit={createCustomer} />
        </DialogContent>
      </Dialog>
    </>
  );
}
