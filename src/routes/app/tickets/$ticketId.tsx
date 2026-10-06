import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Camera, Eye, Lock, Printer, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { Field, Panel, selectClass } from "@/components/app/Field";
import { CustomFieldInput } from "@/components/tickets/CustomFieldInput";
import { StatusMenu } from "@/components/tickets/StatusMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { friendlyDbError, roleAtLeast } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import {
  fetchContacts,
  fetchCustomFields,
  fetchMembers,
  fetchStatuses,
  fetchTicket,
  isOverdue,
  shopToday,
  signedPhotoUrls,
  uploadPhotos,
  type CustomField,
  type Member,
  type Status,
  type Ticket,
} from "@/lib/tickets";

export const Route = createFileRoute("/app/tickets/$ticketId")({
  validateSearch: (s: Record<string, unknown>): { created?: number; photoProblems?: number } => ({
    ...(s["created"] ? { created: 1 } : {}),
    ...(Number(s["photoProblems"]) > 0 ? { photoProblems: Number(s["photoProblems"]) } : {}),
  }),
  head: () => ({ meta: [{ title: "Ticket · Mend" }] }),
  component: TicketDetail,
});

type Event = {
  id: string;
  type: string;
  actor_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
};
type Photo = { id: string; storage_path: string; url?: string | undefined };

function eventText(e: Event): string {
  const d = e.data;
  switch (e.type) {
    case "created":
      return `Ticket #${d["number"]} created`;
    case "status_change":
      return `Moved from ${d["from"]} to ${d["to"]}`;
    case "note":
      return String(d["body"] ?? "");
    case "photo":
      return "Photo added";
    case "edit":
      return `Updated ${(d["fields"] as string[] | undefined)?.join(", ") ?? "details"}`;
    case "assigned":
      return d["to"] ? "Assigned" : "Unassigned";
    case "passcode_set":
      return "Passcode saved";
    case "passcode_revealed":
      return "Passcode revealed";
    case "passcode_purged":
      return "Passcode deleted";
    case "deleted":
      return "Ticket deleted";
    default:
      return e.type;
  }
}

function TicketDetail() {
  const { ticketId } = Route.useParams();
  const { created, photoProblems } = Route.useSearch();
  const { membership, user } = Route.useRouteContext();
  const shop = membership.shop;
  const navigate = useNavigate();
  const isAdmin = roleAtLeast(membership.role, "admin");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [contact, setContact] = useState<{ phone: string | null; email: string | null } | null>(
    null,
  );
  const [events, setEvents] = useState<Event[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [form, setForm] = useState<Partial<Ticket>>({});
  const [note, setNote] = useState("");
  const [passcode, setPasscode] = useState<string | null>(null);
  const [newPasscode, setNewPasscode] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(
    created
      ? {
          tone: "info",
          text: photoProblems
            ? "Ticket saved, but some photos couldn't be uploaded."
            : "Ticket saved.",
        }
      : null,
  );
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const sb = getSupabase();
    try {
      const t = await fetchTicket(ticketId);
      if (!t) return setNotFound(true);
      setTicket(t);
      setForm(t);
      const [s, f, m, c, ev, ph] = await Promise.all([
        fetchStatuses(t.shop_id),
        fetchCustomFields(t.shop_id),
        fetchMembers(t.shop_id),
        fetchContacts([t.customer_id]),
        sb
          .from("ticket_events")
          .select("id, type, actor_id, data, created_at")
          .eq("ticket_id", t.id)
          .order("created_at", { ascending: false }),
        sb
          .from("ticket_photos")
          .select("id, storage_path")
          .eq("ticket_id", t.id)
          .order("created_at"),
      ]);
      setStatuses(s);
      setFields(f);
      setMembers(m);
      setContact(c.get(t.customer_id) ?? null);
      setEvents((ev.data ?? []) as Event[]);
      const list = (ph.data ?? []) as Photo[];
      const urls = await signedPhotoUrls(list.map((p) => p.storage_path));
      setPhotos(list.map((p) => ({ ...p, url: urls.get(p.storage_path) })));
    } catch (e) {
      setMessage({ tone: "error", text: friendlyDbError(e) });
    }
  }, [ticketId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (notFound)
    return <FormAlert tone="error">This ticket doesn't exist or was deleted.</FormAlert>;
  if (!ticket)
    return (
      <p role="status" className="text-muted-foreground">
        Loading…
      </p>
    );

  const status = statuses.find((s) => s.id === ticket.status_id);
  const overdue = isOverdue(ticket, status, shopToday(shop.time_zone));
  const canReveal = isAdmin || ticket.assigned_to === user.id;
  const who = (id: string | null) => {
    const m = members.find((x) => x.user_id === id);
    return m ? m.name || m.email : "Someone";
  };

  async function rpc(name: string, args: Record<string, unknown>, done?: string) {
    const { error } = await getSupabase().rpc(name, args);
    if (error) {
      setMessage({ tone: "error", text: friendlyDbError(error) });
      return false;
    }
    if (done) setMessage({ tone: "info", text: done });
    await load();
    return true;
  }

  async function moveTo(statusId: string) {
    const target = statuses.find((s) => s.id === statusId);
    if (
      target?.is_final &&
      ticket?.has_passcode &&
      !window.confirm("Mark as picked up? The saved device passcode will be deleted.")
    )
      return;
    await rpc(
      "set_ticket_status",
      { p_ticket_id: ticket!.id, p_status_id: statusId },
      `Moved to ${target?.name}.`,
    );
  }

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    const custom = Object.fromEntries(
      Object.entries(form.custom_fields ?? {}).filter(([, v]) => v !== undefined && v !== ""),
    );
    const { error } = await getSupabase()
      .from("tickets")
      .update({
        item_name: form.item_name,
        issue_description: form.issue_description || null,
        item_description: form.item_description || null,
        promised_date: form.promised_date || null,
        assigned_to: form.assigned_to || null,
        custom_fields: custom,
        internal_notes: form.internal_notes || null,
        customer_notes: form.customer_notes || null,
      })
      .eq("id", ticket!.id);
    if (error) return setMessage({ tone: "error", text: friendlyDbError(error) });
    setMessage({ tone: "info", text: "Saved." });
    await load();
  }

  async function reveal() {
    const { data, error } = await getSupabase().rpc("reveal_passcode", { p_ticket_id: ticket!.id });
    if (error) return setMessage({ tone: "error", text: friendlyDbError(error) });
    setPasscode((data as string | null) ?? "");
    await load();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-muted-foreground">#{ticket.ticket_number}</p>
          <h1 className="text-[1.75rem] font-semibold leading-tight">{ticket.item_name}</h1>
          {overdue ? (
            <p className="font-medium text-danger">Overdue (promised {ticket.promised_date})</p>
          ) : null}
        </div>
        <StatusMenu
          className="w-56"
          statuses={statuses}
          value={ticket.status_id}
          onChange={(id) => void moveTo(id)}
          label="Status"
        />
        <Button variant="outline" asChild>
          <Link to="/tag/$ticketId" params={{ ticketId: ticket.id }} target="_blank">
            <Printer /> Claim tag
          </Link>
        </Button>
        {isAdmin ? (
          <Button
            variant="outline"
            onClick={() => {
              if (
                window.confirm(
                  `Delete ticket #${ticket.ticket_number}? This is recorded in the audit log.`,
                )
              )
                void rpc("delete_ticket", { p_ticket_id: ticket.id }).then((ok) => {
                  if (ok) void navigate({ to: "/app/board" });
                });
            }}
          >
            <Trash2 /> Delete
          </Button>
        ) : null}
      </div>
      {message ? (
        <FormAlert tone={message.tone}>
          {message.text}{" "}
          {created ? (
            <Link
              to="/tag/$ticketId"
              params={{ ticketId: ticket.id }}
              target="_blank"
              className="font-medium underline"
            >
              Print the claim tag
            </Link>
          ) : null}
        </FormAlert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <form method="post" onSubmit={saveDetails} className="flex flex-col gap-6">
          <Panel title="Details">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field id="t-item" label="Item">
                  <Input
                    id="t-item"
                    value={form.item_name ?? ""}
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
                    value={form.issue_description ?? ""}
                    onChange={(e) => setForm({ ...form, issue_description: e.target.value })}
                  />
                </Field>
              </div>
              <Field id="t-promised" label="Promised date">
                <Input
                  id="t-promised"
                  type="date"
                  value={form.promised_date ?? ""}
                  onChange={(e) => setForm({ ...form, promised_date: e.target.value })}
                />
              </Field>
              <Field id="t-assignee" label="Assigned to">
                <select
                  id="t-assignee"
                  className={selectClass}
                  value={form.assigned_to ?? ""}
                  onChange={(e) => setForm({ ...form, assigned_to: e.target.value || null })}
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
                    value={form.custom_fields?.[f.id]}
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
                    value={form.internal_notes ?? ""}
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
                    value={form.customer_notes ?? ""}
                    onChange={(e) => setForm({ ...form, customer_notes: e.target.value })}
                  />
                </Field>
              </div>
            </div>
            <Button type="submit" className="mt-4">
              Save details
            </Button>
          </Panel>

          <Panel title="Photos">
            {photos.length ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photos.map((p) => (
                  <li key={p.id}>
                    {p.url ? (
                      <a href={p.url} target="_blank" rel="noreferrer">
                        <img
                          src={p.url}
                          alt="Condition photo"
                          className="aspect-square w-full rounded-md object-cover"
                          loading="lazy"
                        />
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No photos yet.</p>
            )}
            <label
              htmlFor="more-photos"
              className="mt-4 inline-flex h-11 cursor-pointer items-center gap-2 rounded-md border border-input px-4 font-medium hover:bg-accent"
            >
              <Camera className="size-5" aria-hidden /> Add photos
            </label>
            <input
              id="more-photos"
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="sr-only"
              onChange={async (e) => {
                const files = Array.from(e.target.files ?? []);
                if (!files.length) return;
                const problems = await uploadPhotos(ticket.shop_id, ticket.id, files);
                setMessage(
                  problems.length
                    ? { tone: "error", text: problems.join(" ") }
                    : { tone: "info", text: "Photos added." },
                );
                await load();
              }}
            />
          </Panel>

          <Panel title="Estimate, payments and messages">
            <p className="text-muted-foreground">
              Estimates and payments arrive next, then customer messages.
            </p>
          </Panel>
        </form>

        <div className="flex flex-col gap-6">
          <Panel title="Customer">
            <Link
              to="/app/customers/$customerId"
              params={{ customerId: ticket.customer_id }}
              className="text-lg font-semibold underline-offset-4 hover:underline"
            >
              {ticket.customer?.name}
            </Link>
            <dl className="mt-2 flex flex-col gap-1">
              {contact?.phone ? (
                <div>
                  <dt className="sr-only">Phone</dt>
                  <dd>
                    <a href={`tel:${contact.phone}`} className="underline-offset-4 hover:underline">
                      {contact.phone}
                    </a>
                  </dd>
                </div>
              ) : null}
              {contact?.email ? (
                <div>
                  <dt className="sr-only">Email</dt>
                  <dd>
                    <a
                      href={`mailto:${contact.email}`}
                      className="break-all underline-offset-4 hover:underline"
                    >
                      {contact.email}
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>
            {ticket.terms_accepted_at ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Accepted the terms {ticket.terms_accepted_at.slice(0, 10)}
              </p>
            ) : null}
          </Panel>

          {shop.vertical === "electronics" || ticket.has_passcode ? (
            <Panel title="Device passcode">
              {ticket.has_passcode ? (
                passcode !== null ? (
                  <p className="font-mono text-xl tracking-wider">{passcode}</p>
                ) : canReveal ? (
                  <Button variant="outline" onClick={() => void reveal()}>
                    <Eye /> Reveal
                  </Button>
                ) : (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Lock className="size-4" /> Saved. Only the owner, admins or the assigned person
                    can reveal it.
                  </p>
                )
              ) : (
                <p className="text-muted-foreground">No passcode saved.</p>
              )}
              <div className="mt-4 flex gap-2">
                <Input
                  aria-label="New passcode"
                  type="password"
                  autoComplete="off"
                  placeholder={ticket.has_passcode ? "Replace passcode" : "Save a passcode"}
                  value={newPasscode}
                  onChange={(e) => setNewPasscode(e.target.value)}
                  maxLength={64}
                />
                <Button
                  variant="outline"
                  disabled={!newPasscode}
                  onClick={() =>
                    void rpc(
                      "set_ticket_passcode",
                      { p_ticket_id: ticket.id, p_passcode: newPasscode },
                      "Passcode saved.",
                    ).then(() => {
                      setNewPasscode("");
                      setPasscode(null);
                    })
                  }
                >
                  Save
                </Button>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Encrypted. Every reveal is recorded. Deleted automatically at pickup.
              </p>
            </Panel>
          ) : null}

          <Panel title="Timeline">
            <form
              method="post"
              onSubmit={(e) => {
                e.preventDefault();
                void rpc("add_ticket_note", { p_ticket_id: ticket.id, p_body: note }).then((ok) => {
                  if (ok) setNote("");
                });
              }}
              className="mb-4 flex flex-col gap-2"
            >
              <Textarea
                aria-label="Add a note"
                placeholder="Add a note…"
                rows={2}
                className="bg-surface-2 text-base"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={2000}
              />
              <Button type="submit" variant="outline" disabled={!note.trim()}>
                Add note
              </Button>
            </form>
            <ol className="flex flex-col gap-3">
              {events.map((e) => (
                <li key={e.id} className="border-l-2 border-border pl-3">
                  <p className={e.type === "note" ? "whitespace-pre-wrap" : ""}>{eventText(e)}</p>
                  <p className="font-mono text-sm text-muted-foreground">
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: shop.time_zone,
                    }).format(new Date(e.created_at))}{" "}
                    · {who(e.actor_id)}
                  </p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  );
}
