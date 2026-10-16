import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { PageHeader } from "@/components/app/EmptyState";
import { NewCustomerForm, type NewCustomerValues } from "@/components/customers/NewCustomerForm";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { friendlyDbError } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import { fetchContacts, type Customer } from "@/lib/tickets";

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
  const [filter, setFilter] = useState("");
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
      setContacts(await fetchContacts(list.map((c) => c.id)));
    } catch (e) {
      setError(friendlyDbError(e));
    }
  }, [membership.shop.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return customers;
    const digits = q.replace(/\D/g, "");
    return customers.filter((c) => {
      const ct = contacts.get(c.id);
      return (
        c.name.toLowerCase().includes(q) ||
        (!!ct?.email && ct.email.includes(q)) ||
        (digits.length >= 3 && !!ct?.phone && ct.phone.includes(digits))
      );
    });
  }, [customers, contacts, filter]);

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
      <Input
        aria-label="Filter customers"
        placeholder="Filter by name, phone or email"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="mb-4 max-w-md"
      />
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-left">
          <thead className="border-b border-border text-sm text-muted-foreground">
            <tr>
              <th className="px-3 py-3 font-medium">Name</th>
              <th className="px-3 py-3 font-medium">Phone</th>
              <th className="px-3 py-3 font-medium">Email</th>
              <th className="px-3 py-3 font-medium">Prefers</th>
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
                <td className="px-3 py-3">
                  {c.preferred_channel === "sms" ? "Text" : "Email"}
                  {(c.preferred_channel === "sms" ? c.sms_opted_out : c.email_opted_out)
                    ? " (opted out)"
                    : ""}
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-muted-foreground">
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
