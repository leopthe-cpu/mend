import { Mail, MessageSquare, Send } from "lucide-react";
import { useEffect, useState } from "react";

import { Field } from "@/components/app/Field";
import { FormAlert } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  type Channel,
  fetchTemplates,
  kickSender,
  REMINDER_TEMPLATE,
  renderTemplate,
  shopTime,
  smsSegments,
  type Template,
} from "@/lib/messages";
import { friendlyDbError, type Membership } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import {
  type Customer,
  fetchContacts,
  fetchStatuses,
  fetchTicket,
  type Ticket,
} from "@/lib/tickets";
import { cn } from "@/lib/utils";

export type NotifyRequest = {
  ticketId: string;
  kind: "status" | "reminder" | "manual";
  /** For kind "status": the status the ticket just moved into. */
  statusId?: string;
};

type Loaded = {
  ticket: Ticket;
  customer: Customer;
  phone: string | null;
  email: string | null;
  templates: Template[];
  statusName: string;
};

/**
 * "Notify Maria by SMS?" (spec §7.10): nothing is sent until the member
 * presses Send. Shows the rendered message (editable for this send), the
 * channel choice with opt-outs explained, and an SMS segment counter.
 */
export function NotifyDialog({
  request,
  membership,
  onClose,
}: {
  request: NotifyRequest | null;
  membership: Membership;
  onClose: (result?: string) => void;
}) {
  const shop = membership.shop;
  const [data, setData] = useState<Loaded | null>(null);
  const [channel, setChannel] = useState<Channel>("sms");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [edited, setEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!request) return;
    setData(null);
    setError(null);
    setEdited(false);
    let alive = true;
    void (async () => {
      try {
        const ticket = await fetchTicket(request.ticketId);
        if (!ticket) throw new Error("Ticket not found.");
        const db = getSupabase();
        const [cust, contacts, templates, statuses] = await Promise.all([
          db
            .from("customers")
            .select(
              "id, name, preferred_channel, sms_opted_out, email_opted_out, notes, created_at",
            )
            .eq("id", ticket.customer_id)
            .single(),
          fetchContacts([ticket.customer_id]),
          fetchTemplates(ticket.shop_id),
          fetchStatuses(ticket.shop_id),
        ]);
        if (cust.error) throw cust.error;
        const c = contacts.get(ticket.customer_id);
        const loaded: Loaded = {
          ticket,
          customer: cust.data as Customer,
          phone: c?.phone ?? null,
          email: c?.email ?? null,
          templates,
          statusName:
            statuses.find((s) => s.id === (request.statusId ?? ticket.status_id))?.name ?? "",
        };
        if (!alive) return;
        setData(loaded);
        const usable = (ch: Channel) => !blockedReason(loaded, ch);
        const first: Channel = usable(loaded.customer.preferred_channel)
          ? loaded.customer.preferred_channel
          : usable("sms")
            ? "sms"
            : "email";
        setChannel(first);
        fill(loaded, first);
      } catch (e) {
        if (alive) setError(friendlyDbError(e));
      }
    })();
    return () => {
      alive = false;
    };
    // fill is stable for a given request; re-run only when the request changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  function blockedReason(d: Loaded, ch: Channel): string | null {
    if (ch === "sms") {
      if (d.customer.sms_opted_out) return "Opted out of texts (replied STOP or asked you).";
      if (!d.phone) return "No mobile number on file.";
    } else {
      if (d.customer.email_opted_out) return "Opted out of email.";
      if (!d.email) return "No email address on file.";
    }
    return null;
  }

  function fill(d: Loaded, ch: Channel) {
    const vars = {
      customer_name: d.customer.name,
      item_name: d.ticket.item_name,
      shop_name: shop.name,
      ticket_number: d.ticket.ticket_number,
      pickup_hours: shop.business_hours?.text ?? "",
    };
    const t =
      request?.kind === "status"
        ? d.templates.find((x) => x.status_id === request.statusId && x.channel === ch)
        : undefined;
    const text =
      request?.kind === "reminder"
        ? REMINDER_TEMPLATE
        : request?.kind === "manual"
          ? "Hi {customer_name}, "
          : (t?.body ??
            "Hi {customer_name}, an update on your {item_name} at {shop_name}: it's now " +
              `"${d.statusName}".`);
    setBody(renderTemplate(text, vars));
    setSubject(
      renderTemplate(
        t?.subject ??
          (request?.kind === "reminder"
            ? "Reminder: your {item_name} is ready for pickup"
            : "Your {item_name} at {shop_name}"),
        vars,
      ),
    );
  }

  async function send() {
    if (!request || !data) return;
    setSending(true);
    setError(null);
    const { data: rows, error: err } = await getSupabase().rpc("queue_message", {
      p_ticket_id: request.ticketId,
      p_channel: channel,
      p_body: body,
      p_subject: channel === "email" ? subject : null,
      p_kind: request.kind,
    });
    setSending(false);
    if (err) return setError(friendlyDbError(err));
    const r = (rows as { scheduled_for: string; quiet_hours: boolean }[] | null)?.[0];
    kickSender();
    const first = data.customer.name.split(" ")[0] || data.customer.name;
    const what = channel === "sms" ? "Text" : "Email";
    onClose(
      r?.quiet_hours
        ? `Quiet hours: the ${what.toLowerCase()} to ${first} will go out ${shopTime(r.scheduled_for, shop.time_zone)}.`
        : `${what} to ${first} is on its way.`,
    );
  }

  const seg = smsSegments(body);
  const blocked = data ? blockedReason(data, channel) : null;
  const first = data ? data.customer.name.split(" ")[0] || data.customer.name : "";

  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto bg-background text-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {data
              ? `${request?.kind === "reminder" ? "Remind" : "Notify"} ${first} by ${channel === "sms" ? "text" : "email"}?`
              : "Notify the customer?"}
          </DialogTitle>
          <DialogDescription>
            {data
              ? `#${data.ticket.ticket_number} · ${data.ticket.item_name}${
                  request?.kind === "status" && data.statusName ? ` · now ${data.statusName}` : ""
                }`
              : "Loading…"}
          </DialogDescription>
        </DialogHeader>

        {data ? (
          <form
            method="post"
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <fieldset className="grid grid-cols-2 gap-2">
              <legend className="sr-only">Channel</legend>
              {(["sms", "email"] as Channel[]).map((ch) => {
                const reason = blockedReason(data, ch);
                const Icon = ch === "sms" ? MessageSquare : Mail;
                return (
                  <label
                    key={ch}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2",
                      channel === ch ? "border-primary ring-2 ring-primary/30" : "border-border",
                      reason && "cursor-not-allowed opacity-60",
                    )}
                  >
                    <input
                      type="radio"
                      name="channel"
                      className="sr-only"
                      value={ch}
                      checked={channel === ch}
                      disabled={!!reason}
                      onChange={() => {
                        setChannel(ch);
                        if (!edited) fill(data, ch);
                      }}
                    />
                    <Icon className="size-5 shrink-0" aria-hidden />
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium">{ch === "sms" ? "Text" : "Email"}</span>
                      <span className="text-sm break-words text-muted-foreground [overflow-wrap:anywhere]">
                        {reason ?? (ch === "sms" ? data.phone : data.email)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            {channel === "email" ? (
              <Field id="nd-subject" label="Subject">
                <Input
                  id="nd-subject"
                  value={subject}
                  maxLength={200}
                  onChange={(e) => {
                    setSubject(e.target.value);
                    setEdited(true);
                  }}
                />
              </Field>
            ) : null}
            <Field
              id="nd-body"
              label="Message"
              hint={
                channel === "sms"
                  ? `${seg.units} of ${seg.perSegment * seg.segments} characters · ${seg.segments} text${seg.segments > 1 ? "s" : ""}${seg.encoding === "UCS-2" ? " (special characters use more space)" : ""}`
                  : `${body.length} characters`
              }
            >
              <Textarea
                id="nd-body"
                rows={5}
                maxLength={1600}
                className="bg-surface-2 text-base"
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  setEdited(true);
                }}
              />
            </Field>
            {channel === "email" && shop.email ? (
              <p className="text-sm text-muted-foreground">Replies go to {shop.email}.</p>
            ) : channel === "email" ? (
              <p className="text-sm text-muted-foreground">
                Add your shop email in Settings so customers can reply.
              </p>
            ) : null}

            {error ? <FormAlert tone="error">{error}</FormAlert> : null}
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => onClose()}>
                Skip
              </Button>
              <Button type="submit" disabled={sending || !!blocked || !body.trim()}>
                <Send /> {sending ? "Sending…" : "Send"}
              </Button>
            </div>
          </form>
        ) : error ? (
          <FormAlert tone="error">{error}</FormAlert>
        ) : (
          <p className="text-muted-foreground">Loading…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
