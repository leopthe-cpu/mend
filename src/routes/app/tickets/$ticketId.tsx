import { createFileRoute, Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Pencil, Printer, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { BackButton } from "@/components/app/BackButton";
import { EditCustomerDialog } from "@/components/customers/EditCustomerDialog";
import { FormAlert } from "@/components/auth/AuthLayout";
import { Panel } from "@/components/app/Field";
import { Button } from "@/components/ui/button";
import { MoneySection } from "@/components/tickets/MoneySection";
import { PasscodePanel } from "@/components/tickets/PasscodePanel";
import { StatusMenu } from "@/components/tickets/StatusMenu";
import { TicketDetailsPanel } from "@/components/tickets/TicketDetailsPanel";
import { TicketPhotosPanel } from "@/components/tickets/TicketPhotosPanel";
import { TicketTimeline } from "@/components/tickets/TicketTimeline";
import { promptHeldMessages } from "@/components/messages/messageToasts";
import { NotifyDialog, type NotifyRequest } from "@/components/messages/NotifyDialog";
import { TicketMessages } from "@/components/messages/TicketMessages";
import { shortDate } from "@/lib/calendar";
import { friendlyDbError, roleAtLeast } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import {
  fetchContacts,
  fetchCustomFields,
  fetchMembers,
  fetchStatuses,
  fetchTicket,
  isOverdue,
  memberName,
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
  const [editCustomer, setEditCustomer] = useState(false);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [contact, setContact] = useState<{ phone: string | null; email: string | null } | null>(
    null,
  );
  const [events, setEvents] = useState<Event[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loadedAll, setLoadedAll] = useState(false);
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
      setPhotos(
        list.map((p) => {
          const url = urls.get(p.storage_path);
          return url ? { ...p, url } : p;
        }),
      );
      setLoadedAll(true);
    } catch (e) {
      setMessage({ tone: "error", text: friendlyDbError(e) });
    }
  }, [ticketId]);
  useEffect(() => {
    void load();
  }, [load]);

  // The board's photo count and message icon link straight to a panel
  // (#photos, #messages; decision 142). Scroll there once everything above it
  // has loaded, so it doesn't shift away.
  const { hash } = useLocation();
  const scrolledTo = useRef("");
  useEffect(() => {
    if (!loadedAll || !hash || scrolledTo.current === hash) return;
    const frame = requestAnimationFrame(() => {
      const el = document.getElementById(hash);
      if (!el) return;
      scrolledTo.current = hash;
      el.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [loadedAll, hash]);

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
    return m ? memberName(m) : "Someone";
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
    if (!ok) return;
    // Messages that hadn't gone out are held; ask whether to still send them.
    void promptHeldMessages({
      ticketId: ticket!.id,
      ticketNumber: ticket!.ticket_number,
      statusName: target?.name ?? "a new status",
      who: ticket!.customer?.name.split(" ")[0] || "the customer",
    }).then(() => setMessagesKey((k) => k + 1));
    if (target?.notify_by_default) {
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
      <div className="flex flex-wrap items-start gap-3">
        <BackButton to="/app/tickets" label="Back" />
        {/* The title keeps at least 14 rem; on phones Print and Delete move
            to the next line instead of squeezing it (decision 121). */}
        <div className="min-w-0 flex-1 basis-[14rem]">
          <p className="font-mono text-muted-foreground">#{ticket.ticket_number}</p>
          <h1 className="text-[1.75rem] font-semibold leading-tight">{ticket.item_name}</h1>
          {overdue ? (
            <p className="font-medium text-danger">
              Overdue (promised {shortDate(ticket.promised_date ?? "")})
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/tag/$ticketId" params={{ ticketId: ticket.id }} target="_blank">
              <Printer /> Print
            </Link>
          </Button>
          {isAdmin ? (
            <Button
              variant="ghost"
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

      {/* grid-cols-1 sizes the column to the screen, so a long word can't widen the page. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <TicketDetailsPanel
            ticket={ticket}
            fields={fields}
            members={members}
            status={
              <div className="flex flex-col gap-2 sm:max-w-xs">
                <label htmlFor="t-status" className="text-sm font-semibold">
                  Status
                </label>
                <StatusMenu
                  id="t-status"
                  statuses={statuses}
                  value={ticket.status_id}
                  onChange={(id) => void moveTo(id)}
                  label="Status"
                />
              </div>
            }
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
          <Panel
            title="Customer"
            action={
              <Button
                variant="outline"
                size="icon"
                className="size-11"
                aria-label="Edit customer"
                title="Edit customer"
                onClick={() => setEditCustomer(true)}
              >
                <Pencil />
              </Button>
            }
          >
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
            {ticket.customer?.sms_opted_out ? (
              // Decision 77: texts won't go out; point staff to the phone/email.
              <p
                role="status"
                className="mt-3 rounded-md border border-border bg-muted p-3 text-sm"
              >
                <strong>Texts are off.</strong>{" "}
                {ticket.customer.sms_opt_out_source === "stop"
                  ? "The customer replied STOP"
                  : "Texts were turned off"}
                {ticket.customer.sms_opted_out_at
                  ? ` on ${new Intl.DateTimeFormat("en-CA", {
                      timeZone: membership.shop.time_zone,
                      month: "short",
                      day: "numeric",
                    }).format(new Date(ticket.customer.sms_opted_out_at))}`
                  : ""}
                . {contact?.phone ? "Call them" : "Contact them"}
                {contact?.email && !ticket.customer.email_opted_out ? " or send an email" : ""}{" "}
                instead.
              </p>
            ) : null}
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
            onClose={(sent) => {
              setNotify(null);
              if (sent) {
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
      <EditCustomerDialog
        open={editCustomer}
        onOpenChange={setEditCustomer}
        shopId={ticket.shop_id}
        customerId={ticket.customer_id}
        onSaved={load}
      />
    </div>
  );
}
