import { useState } from "react";

import { Field, Panel, selectClass } from "@/components/app/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CustomFieldInput } from "@/components/tickets/CustomFieldInput";
import type { CustomField, Member, Ticket } from "@/lib/tickets";

type EditingState = {
  item_name: string;
  issue_description: string;
  promised_date: string;
  assigned_to: string;
  custom_fields: Record<string, string | number>;
  internal_notes: string;
  customer_notes: string;
};

function emptyState(ticket: Ticket): EditingState {
  return {
    item_name: ticket.item_name,
    issue_description: ticket.issue_description ?? "",
    promised_date: ticket.promised_date ?? "",
    assigned_to: ticket.assigned_to ?? "",
    custom_fields: { ...(ticket.custom_fields ?? {}) },
    internal_notes: ticket.internal_notes ?? "",
    customer_notes: ticket.customer_notes ?? "",
  };
}

function dash(v: string | null | undefined): string {
  return v && v.trim() ? v : "—";
}

function assignedName(members: Member[], userId: string | null): string {
  if (!userId) return "—";
  const m = members.find((x) => x.user_id === userId);
  return m ? m.name || m.email : "—";
}

export function TicketDetailsPanel({
  ticket,
  fields,
  members,
  onSaved,
}: {
  ticket: Ticket;
  fields: CustomField[];
  members: Member[];
  onSaved: (values: EditingState) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditingState>(emptyState(ticket));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function startEditing() {
    setForm(emptyState(ticket));
    setSaved(false);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setSaved(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaved(form);
      setEditing(false);
      setSaved(true);
    } catch {
      // The parent already shows the error message; stay in edit mode.
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <Panel title="Details">
        <form method="post" onSubmit={handleSave} className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field id="t-item" label="Item">
                <Input
                  id="t-item"
                  value={form.item_name}
                  onChange={(e) => setForm({ ...form, item_name: e.target.value })}
                  maxLength={120}
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field id="t-issue" label="What needs doing">
                <Textarea
                  id="t-issue"
                  rows={3}
                  className="bg-surface-2 text-base"
                  value={form.issue_description}
                  onChange={(e) => setForm({ ...form, issue_description: e.target.value })}
                />
              </Field>
            </div>
            <Field id="t-promised" label="Promised date">
              <Input
                id="t-promised"
                type="date"
                value={form.promised_date}
                onChange={(e) => setForm({ ...form, promised_date: e.target.value })}
              />
            </Field>
            <Field id="t-assignee" label="Assigned to">
              <select
                id="t-assignee"
                className={selectClass}
                value={form.assigned_to}
                onChange={(e) => setForm({ ...form, assigned_to: e.target.value || "" })}
              >
                <option value="">Nobody</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name || m.email}
                  </option>
                ))}
              </select>
            </Field>
            {fields.map((f) => (
              <Field key={f.id} id={`tcf-${f.id}`} label={f.label} hint={f.help_text}>
                <CustomFieldInput
                  id={`tcf-${f.id}`}
                  field={f}
                  value={form.custom_fields[f.id]}
                  onChange={(v) =>
                    setForm({
                      ...form,
                      custom_fields: { ...(form.custom_fields ?? {}), [f.id]: v as string },
                    })
                  }
                />
              </Field>
            ))}
            <div className="sm:col-span-2">
              <Field id="t-internal" label="Internal notes" hint="Only your team sees these.">
                <Textarea
                  id="t-internal"
                  rows={3}
                  className="bg-surface-2 text-base"
                  value={form.internal_notes}
                  onChange={(e) => setForm({ ...form, internal_notes: e.target.value })}
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field
                id="t-customer-notes"
                label="Notes for the customer"
                hint="Can appear on estimates and invoices."
              >
                <Textarea
                  id="t-customer-notes"
                  rows={3}
                  className="bg-surface-2 text-base"
                  value={form.customer_notes}
                  onChange={(e) => setForm({ ...form, customer_notes: e.target.value })}
                />
              </Field>
            </div>
          </div>
          <div className="flex gap-3">
            <Button type="submit" disabled={saving}>
              Save
            </Button>
            <Button type="button" variant="outline" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </form>
      </Panel>
    );
  }

  return (
    <Panel title="Details">
      {saved ? <p className="mb-4 text-sm text-success">Saved.</p> : null}
      <div className="flex items-center justify-between">
        <h3 className="sr-only">Details</h3>
        <Button type="button" variant="outline" onClick={startEditing}>
          Edit
        </Button>
      </div>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <dt className="text-sm text-muted-foreground">Item</dt>
          <dd>{dash(ticket.item_name)}</dd>
        </div>
        {ticket.item_description?.trim() ? (
          <div className="sm:col-span-2">
            <dt className="text-sm text-muted-foreground">Item details</dt>
            <dd className="whitespace-pre-wrap">{ticket.item_description}</dd>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <dt className="text-sm text-muted-foreground">What needs doing</dt>
          <dd className="whitespace-pre-wrap">{dash(ticket.issue_description)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Promised date</dt>
          <dd>{dash(ticket.promised_date)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Assigned to</dt>
          <dd>{assignedName(members, ticket.assigned_to)}</dd>
        </div>
        {fields.map((f) => {
          const raw = ticket.custom_fields?.[f.id];
          const val = raw === undefined || raw === "" ? "—" : String(raw);
          return (
            <div key={f.id}>
              <dt className="text-sm text-muted-foreground">{f.label}</dt>
              <dd>{val}</dd>
            </div>
          );
        })}
        <div className="sm:col-span-2">
          <dt className="text-sm text-muted-foreground">Internal notes</dt>
          <dd className="whitespace-pre-wrap">{dash(ticket.internal_notes)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-sm text-muted-foreground">Notes for the customer</dt>
          <dd className="whitespace-pre-wrap">{dash(ticket.customer_notes)}</dd>
        </div>
      </dl>
    </Panel>
  );
}
