import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Printer, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { Panel } from "@/components/app/Field";
import { Button } from "@/components/ui/button";
import { MoneySection } from "@/components/tickets/MoneySection";
import { PasscodePanel } from "@/components/tickets/PasscodePanel";
import { StatusMenu } from "@/components/tickets/StatusMenu";
import { TicketDetailsPanel } from "@/components/tickets/TicketDetailsPanel";
import { TicketPhotosPanel } from "@/components/tickets/TicketPhotosPanel";
import { TicketTimeline } from "@/components/tickets/TicketTimeline";
import { NotifyDialog, type NotifyRequest } from "@/components/messages/NotifyDialog";
import { TicketMessages } from "@/components/messages/TicketMessages";
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
type Photo = { id: string; storage_path: string; url?: string };

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
  const [passcode, setPasscode] = useState<string | null>(null);
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
  const [notify, setNotify] = useState<NotifyRequest | null>(null);
  const [messagesKey, setMessagesKey] = useState(0);

  const reloadEvents = useCallback(() => {
    void getSupabase()
      .from("ticket_events")
      .select("id, type, actor_id, data, created_at")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setEvents(data as Event[]);
      });
  }, [ticketId]);

  const load = useCallback(async () => {
    const sb = getSupabase();
    try {
      const t = await fetchTicket(ticketId);
      if (!t) return setNotFound(true);
      setTicket(t);
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
    const ok = await rpc(
      "set_ticket_status",
      { p_ticket_id: ticket!.id, p_status_id: statusId },
      `Moved to ${target?.name}.`,
    );
    if (ok && target?.notify_by_default) {
      setNotify({ ticketId: ticket!.id, kind: "status", statusId });
    }
  }

  async function saveDetails(values: {
    item_name: string;
    issue_description: string;
    promised_date: string;
    assigned_to: string;
    custom_fields: Record<string, string | number>;
    internal_notes: string;
    customer_notes: string;
  }) {
    const custom = Object.fromEntries(
      Object.entries(values.custom_fields ?? {}).filter(([, v]) => v !== undefined && v !== ""),
    );
    const { error } = await getSupabase()
      .from("tickets")
      .update({
        item_name: values.item_name,
        issue_description: values.issue_description || null,
        item_description: null,
        promised_date: values.promised_date || null,
        assigned_to: values.assigned_to || null,
        custom_fields: custom,
        internal_notes: values.internal_notes || null,
        customer_notes: values.customer_notes || null,
      })
      .eq("id", ticket!.id);
    if (error) {
      setMessage({ tone: "error", text: friendlyDbError(error) });
      throw error;
    }
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
        <div className="flex min-w-0 flex-col gap-6">
          <TicketDetailsPanel
            ticket={ticket}
            fields={fields}
            members={members}
            onSaved={saveDetails}
          />
          <TicketPhotosPanel ticket={ticket} photos={photos} onReload={load} />
          <MoneySection
            ticket={ticket}
            membership={membership}
            customerName={ticket.customer?.name ?? ""}
            onChanged={reloadEvents}
          />
        </div>

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

          <PasscodePanel
            ticket={ticket}
            shopVertical={shop.vertical}
            canReveal={canReveal}
            passcode={passcode}
            onPasscodeChange={setPasscode}
            onReload={load}
          />

          <TicketMessages
            ticketId={ticket.id}
            timeZone={shop.time_zone}
            refreshKey={messagesKey}
            onCompose={() => setNotify({ ticketId: ticket.id, kind: "manual" })}
            onChanged={reloadEvents}
          />
          <NotifyDialog
            request={notify}
            membership={membership}
            onClose={(result) => {
              setNotify(null);
              if (result) {
                setMessage({ tone: "info", text: result });
                setMessagesKey((k) => k + 1);
                reloadEvents();
              }
            }}
          />

          <TicketTimeline
            ticket={ticket}
            events={events}
            currency={shop.currency}
            timeZone={shop.time_zone}
            who={who}
            onReload={load}
          />
        </div>
      </div>
    </div>
  );
}