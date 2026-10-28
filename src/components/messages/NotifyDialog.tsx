import { CalendarClock, Mail, MessageSquare, Send } from "lucide-react";
import { Link } from "@tanstack/react-router";
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
  REMINDER_TEMPLATE,
  renderTemplate,
  shopTime,
  smsSegments,
  type Template,
} from "@/lib/messages";
import { pickupHoursText, promisedDateText } from "@/lib/hours";
import { messageWhat, sendPlan, type PlanMessage, type SendPlan } from "@/lib/notifications";
import {
  friendlyDbError,
  EMAILS_NEED_CONTACT,
  missingEmailContact,
  missingTextContact,
  shopAttention,
  TEXTS_NEED_CONTACT,
  type Membership,
} from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import {
  type Customer,
  fetchContacts,
  fetchStatuses,
  fetchTicket,
  memberName,
  type Ticket,
} from "@/lib/tickets";
import { cn } from "@/lib/utils";

import { toastQueued } from "./messageToasts";

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
  /** `true` when a message was queued (the caller refreshes; the toast says so). */
  onClose: (sent?: boolean) => void;
}) {
  const shop = membership.shop;
  const [data, setData] = useState<Loaded | null>(null);
  const [channel, setChannel] = useState<Channel>("sms");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [edited, setEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Decision 138: every message waits 20 s; the next goes 2 minutes after the
  // previous one (Schedule), one at a time; a repeat needs a second click.
  const [plan, setPlan] = useState<SendPlan>({ mode: "send" });
  const [repeat, setRepeat] = useState<string | null>(null);
  // A different text or channel is checked again.
  useEffect(() => setRepeat(null), [channel, body]);

  useEffect(() => {
    setPlan({ mode: "send" });
    setRepeat(null);
    if (!request) return;
    let alive = true;
    void (async () => {
      const { data: rows } = await getSupabase()
        .from("messages")
        .select("status, sent_at, scheduled_for, after_cooldown")
        .eq("ticket_id", request.ticketId)
        .not("status", "in", "(canceled,failed)")
        .order("created_at", { ascending: false })
        .limit(20);
      if (alive) setPlan(sendPlan((rows ?? []) as PlanMessage[]));
    })();
    return () => {
      alive = false;
    };
  }, [request]);

  // Who sent an earlier message, for the repeat note.
  async function senderName(id: string | null, kind: string): Promise<string> {
    if (!id || kind === "created") return "Mend";
    const { data: p } = await getSupabase()
      .from("profiles")
      .select("full_name, email")
      .eq("user_id", id)
      .maybeSingle();
    return memberName({ name: (p?.full_name as string) ?? "", email: (p?.email as string) ?? "" });
  }

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
      // Decision 131: the database refuses texts until the shop has both.
      if (missingTextContact(shop)) return TEXTS_NEED_CONTACT;
      if (d.customer.sms_opted_out) return "Opted out of texts (replied STOP or asked you).";
      if (!d.phone) return "No mobile number on file.";
    } else {
      // Decision 143: and emails until it has an email address.
      if (missingEmailContact(shop)) return EMAILS_NEED_CONTACT;
      if (d.customer.email_opted_out) return "Opted out of email.";
      if (!d.email) return "No email address on file.";
    }
    return null;
  }

  function fill(d: Loaded, ch: Channel) {
    const vars = {
      customer_first_name: d.customer.name.split(" ")[0] || d.customer.name,
      customer_name: d.customer.name,
      item_name: d.ticket.item_name,
      ticket_title: d.ticket.item_name,
      shop_name: shop.name,
      ticket_number: d.ticket.ticket_number,
      // Shop days (decision 79): when to come, from now, and the ready day's hours.
      pickup_hours: pickupHoursText(
        shop.business_hours?.schedule,
        shop.business_hours?.text ?? "",
        shop.time_zone,
      ),
      shop_hours: shop.business_hours?.text ?? "",
      promised_date: d.ticket.promised_date
        ? promisedDateText(d.ticket.promised_date, shop.business_hours?.schedule)
        : "a date to be confirmed",
    };
    const t =
      request?.kind === "status"
        ? d.templates.find(
            (x) => x.kind === "status" && x.status_id === request.statusId && x.channel === ch,
          )
        : request?.kind === "reminder"
          ? d.templates.find((x) => x.kind === "reminder" && x.channel === ch)
          : undefined;
    const text =
      request?.kind === "reminder"
        ? (t?.body ?? REMINDER_TEMPLATE)
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
    const db = getSupabase();
    // The same status update, or the same text, again: say so and ask once.
    if (!repeat) {
      const { data: prev } = await db.rpc("find_repeat_message", {
        p_ticket_id: request.ticketId,
        p_kind: request.kind,
        p_channel: channel,
        p_body: body,
      });
      const p = (
        prev as
          { created_at: string; channel: Channel; kind: string; sent_by: string | null }[] | null
      )?.[0];
      if (p) {
        const who = await senderName(p.sent_by, p.kind);
        setRepeat(
          `${who} already sent ${messageWhat(p.kind, p.channel)} like this (${shopTime(p.created_at, shop.time_zone)}).`,
        );
        setSending(false);
        return;
      }
    }
    const { data: rows, error: err } = await db.rpc("queue_message", {
      p_ticket_id: request.ticketId,
      p_channel: channel,
      p_body: body,
      p_subject: channel === "email" ? subject : null,
      p_kind: request.kind,
    });
    setSending(false);
    if (err) return setError(friendlyDbError(err));
    const r = (
      rows as { message_id: string; scheduled_for: string; quiet_hours: boolean }[] | null
    )?.[0];
    if (r)
      toastQueued({
        messageId: r.message_id,
        channel,
        who: data.customer.name.split(" ")[0] || data.customer.name,
        scheduledFor: r.scheduled_for,
        quietHours: r.quiet_hours,
        timeZone: shop.time_zone,
      });
    onClose(true);
  }

  const seg = smsSegments(body);
  const blocked = data ? blockedReason(data, channel) : null;
  // Both channels blocked, and shop setup is part of why.
  const setupBlocked =
    !!data &&
    !!blockedReason(data, "sms") &&
    !!blockedReason(data, "email") &&
    (missingTextContact(shop) || missingEmailContact(shop));
  const first = data ? data.customer.name.split(" ")[0] || data.customer.name : "";

  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-h-[92svh] overflow-y-auto bg-background text-foreground sm:max-w-lg"
        // A held-message toast may be open below: answering it must not close
        // this dialog (decision 138).
        onInteractOutside={(e) => {
          if ((e.target as Element | null)?.closest?.("[data-sonner-toaster]")) e.preventDefault();
        }}
      >
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
            {plan.mode !== "send" ? (
              <p
                role="status"
                className="rounded-lg border border-status-waiting bg-card px-3 py-2 text-sm text-foreground"
              >
                {plan.mode === "schedule" ? (
                  <>
                    <strong className="font-semibold">Scheduled:</strong> a message to {first} just
                    went out or is on its way. This one goes 2 minutes after it (
                    {shopTime(new Date(plan.at).toISOString(), shop.time_zone)})
                  </>
                ) : (
                  <>
                    <strong className="font-semibold">One message is already scheduled</strong> (
                    {shopTime(new Date(plan.at).toISOString(), shop.time_zone)}). Send this after it
                    goes out, or cancel it under the ticket's Messages.
                  </>
                )}
              </p>
            ) : null}
            {repeat ? (
              <p
                role="alert"
                className="rounded-lg border border-status-waiting bg-card px-3 py-2 text-sm text-foreground"
              >
                <strong className="font-semibold">Already sent:</strong> {repeat} Send it again?
              </p>
            ) : null}
            <fieldset className="grid grid-cols-2 gap-2">
              <legend className="sr-only">Channel</legend>
              {(["sms", "email"] as Channel[]).map((ch) => {
                const reason = blockedReason(data, ch);
                const Icon = ch === "sms" ? MessageSquare : Mail;
                // Shop setup is fixable here: link to the exact field (Oz, 28 Oct).
                const fix =
                  ch === "sms"
                    ? missingTextContact(shop)
                      ? {
                          hash: shopAttention(shop).find((f) => f !== "email") ?? "address",
                          label: "Add address and phone",
                        }
                      : null
                    : missingEmailContact(shop)
                      ? { hash: "email", label: "Add shop email" }
                      : null;
                return (
                  <label
                    key={ch}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2",
                      channel === ch ? "border-primary ring-2 ring-primary/30" : "border-border",
                      reason && "cursor-not-allowed",
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
                    <Icon className={cn("size-5 shrink-0", reason && "opacity-60")} aria-hidden />
                    <span className="flex min-w-0 flex-col">
                      <span className={cn("font-medium", reason && "opacity-60")}>
                        {ch === "sms" ? "Text" : "Email"}
                      </span>
                      <span className="text-sm break-words text-muted-foreground [overflow-wrap:anywhere]">
                        {fix
                          ? `Your shop needs ${ch === "sms" ? "an address and phone to send texts" : "an email address to send emails"}.`
                          : (reason ?? (ch === "sms" ? data.phone : data.email))}
                      </span>
                      {fix ? (
                        <Link
                          to="/app/settings/shop"
                          hash={fix.hash}
                          onClick={() => onClose()}
                          className="text-sm font-medium text-primary underline underline-offset-4"
                        >
                          {fix.label}
                        </Link>
                      ) : null}
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
                  ? `${seg.units} of ${seg.perSegment * seg.segments} characters · ${seg.segments} text${seg.segments > 1 ? "s" : ""}${seg.encoding === "UCS-2" ? " (special characters use more space)" : ""}. A customer's first text adds "Reply STOP to opt out. Shop info:" and a link to your shop's contact page.`
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
            {setupBlocked ? (
              // Nothing can be sent until the shop is set up (Oz, 28 Oct).
              <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground">
                Finish setting up your shop before sending messages: Mend needs its{" "}
                {shopAttention(shop)
                  .join(", ")
                  .replace(/, ([^,]*)$/, " and $1")}
                .{" "}
                <Link
                  to="/app/settings/shop"
                  hash={shopAttention(shop)[0] ?? ""}
                  onClick={() => onClose()}
                  className="font-medium text-primary underline underline-offset-4"
                >
                  Open shop settings
                </Link>
              </div>
            ) : channel === "email" && shop.email ? (
              <p className="text-sm text-muted-foreground">Replies go to {shop.email}.</p>
            ) : null}

            {error ? <FormAlert tone="error">{error}</FormAlert> : null}
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => onClose()}>
                Skip
              </Button>
              <Button
                type="submit"
                disabled={sending || !!blocked || !body.trim() || plan.mode === "full"}
              >
                {plan.mode === "send" ? <Send /> : <CalendarClock />}{" "}
                {sending
                  ? "Sending…"
                  : plan.mode === "full"
                    ? "1 scheduled"
                    : `${plan.mode === "schedule" ? "Schedule" : "Send"}${repeat ? " again" : ""}`}
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
