import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { Field, Panel, selectClass } from "@/components/app/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { friendlyDbError } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import { fetchContacts, fetchStatuses, type Customer, type Status } from "@/lib/tickets";

export const Route = createFileRoute("/app/customers/$customerId")({
  head: () => ({ meta: [{ title: "Customer · Mend" }] }),
  component: CustomerDetail,
});

type Row = {
  id: string;
  ticket_number: number;
  item_name: string;
  status_id: string;
  created_at: string;
};

function CustomerDetail() {
  const { customerId } = Route.useParams();
  const { membership } = Route.useRouteContext();
  const [c, setC] = useState<Customer | null>(null);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    channel: "sms" as "sms" | "email",
    notes: "",
  });
  const [tickets, setTickets] = useState<Row[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("customers")
      .select("id, name, preferred_channel, sms_opted_out, email_opted_out, notes, created_at")
      .eq("id", customerId)
      .maybeSingle();
    if (error || !data)
      return setMessage({
        tone: "error",
        text: error ? friendlyDbError(error) : "Customer not found.",
      });
    const cust = data as Customer;
    setC(cust);
    const contacts = await fetchContacts([cust.id]);
    const ct = contacts.get(cust.id);
    setForm({
      name: cust.name,
      phone: ct?.phone ?? "",
      email: ct?.email ?? "",
      channel: cust.preferred_channel,
      notes: cust.notes ?? "",
    });
    const { data: t } = await sb
      .from("tickets")
      .select("id, ticket_number, item_name, status_id, created_at")
      .eq("customer_id", cust.id)
      .order("ticket_number", { ascending: false });
    setTickets((t ?? []) as Row[]);
    setStatuses(await fetchStatuses(membership.shop.id));
  }, [customerId, membership.shop.id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await getSupabase().rpc("save_customer", {
      p_shop_id: membership.shop.id,
      p_customer_id: customerId,
      p_name: form.name,
      p_phone: form.phone || null,
      p_email: form.email || null,
      p_preferred_channel: form.channel,
      p_notes: form.notes || null,
    });
    if (error) return setMessage({ tone: "error", text: friendlyDbError(error) });
    setMessage({ tone: "info", text: "Saved." });
    await load();
  }

  if (!c)
    return message ? (
      <FormAlert tone={message.tone}>{message.text}</FormAlert>
    ) : (
      <p role="status">Loading…</p>
    );

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <h1 className="text-[1.75rem] font-semibold">{c.name}</h1>
      {message ? <FormAlert tone={message.tone}>{message.text}</FormAlert> : null}
      <form method="post" onSubmit={save}>
        <Panel title="Contact">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field id="c-name" label="Name">
                <Input
                  id="c-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  maxLength={120}
                />
              </Field>
            </div>
            <Field id="c-phone" label="Mobile phone">
              <Input
                id="c-phone"
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
            <Field id="c-email" label="Email">
              <Input
                id="c-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field id="c-channel" label="Prefers">
              <select
                id="c-channel"
                className={selectClass}
                value={form.channel}
                onChange={(e) => setForm({ ...form, channel: e.target.value as "sms" | "email" })}
              >
                <option value="sms">Text message</option>
                <option value="email">Email</option>
              </select>
            </Field>
            <div className="flex flex-col justify-end gap-1 text-sm">
              <span>Texts: {c.sms_opted_out ? "opted out (replied STOP)" : "allowed"}</span>
              <span>Emails: {c.email_opted_out ? "opted out" : "allowed"}</span>
            </div>
            <div className="sm:col-span-2">
              <Field id="c-notes" label="Notes">
                <Textarea
                  id="c-notes"
                  rows={3}
                  className="bg-surface-2 text-base"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  maxLength={2000}
                />
              </Field>
            </div>
          </div>
          <Button type="submit" className="mt-4">
            Save
          </Button>
        </Panel>
      </form>
      <Panel title="Tickets">
        <ul className="divide-y divide-border">
          {tickets.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 py-3">
              <Link
                to="/app/tickets/$ticketId"
                params={{ ticketId: t.id }}
                className="font-mono underline-offset-4 hover:underline"
              >
                #{t.ticket_number}
              </Link>
              <span className="flex-1">{t.item_name}</span>
              <span className="text-muted-foreground">
                {statuses.find((s) => s.id === t.status_id)?.name}
              </span>
            </li>
          ))}
          {!tickets.length ? <li className="py-3 text-muted-foreground">No tickets yet.</li> : null}
        </ul>
      </Panel>
    </div>
  );
}
