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
import { TokenEditor } from "@/components/messages/TokenEditor";
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
  missingEmailContact,
  missingTextContact,
  shopAttention,
  type AttentionField,
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
import { balance, fetchMoney } from "@/lib/estimates";
import { formatMoney } from "@/lib/money";
import { parseTemplate, toPlain, type Segment } from "@/lib/messageTokens";
import { MESSAGE_FIELDS } from "@/lib/messages";

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
  /** What's left to pay, for {amount_due} (decision 146). */
  amountDue: string;
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
  // The editors' starting content and the ticket's values for the + menu.
  const [bodySegs, setBodySegs] = useState<Segment[]>([]);
  const [subjectSegs, setSubjectSegs] = useState<Segment[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [editorKey, setEditorKey] = useState(0);
  const fieldOptions = MESSAGE_FIELDS.map((f) => ({ ...f, value: values[f.field] ?? "" }));
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
        const [cust, contacts, templates, statuses, money] = await Promise.all([
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
          fetchMoney(ticket.id).catch(() => null),
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
          amountDue: formatMoney(money ? Math.max(0, balance(money).balance) : 0, shop.currency),
        };
        if (!alive) return;
        setData(loaded);
        // Text unless the customer can't get texts (Oz, 29 Oct).
        const first: Channel =
          customerBlocked(loaded, "sms") && !customerBlocked(loaded, "email") ? "email" : "sms";
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

  /** The shop isn't set up for this channel yet (decisions 131, 143). */
  function shopBlocked(ch: Channel): boolean {
    return ch === "sms" ? missingTextContact(shop) : missingEmailContact(shop);
  }

  /** The shop details this channel still needs, for the link to the exact field. */
  function missingFor(ch: Channel): AttentionField[] {
    return shopAttention(shop).filter((f) => (ch === "sms" ? f !== "email" : f === "email"));
  }

  /** Why this customer can't get this channel: the tile is darkened and can't be picked. */
  function customerBlocked(d: Loaded, ch: Channel): string | null {
    if (ch === "sms") {
      if (d.customer.sms_opted_out) return "Opted out of texts (replied STOP or asked you).";
      if (!d.phone) return "No mobile number on file.";
    } else {
      if (d.customer.email_opted_out) return "Opted out of email.";
      if (!d.email) return "No email address on file.";
    }
    return null;
  }

  function blockedReason(d: Loaded, ch: Channel): string | null {
    return shopBlocked(ch) ? "shop" : customerBlocked(d, ch);
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
      status_name: d.statusName,
      amount_due: d.amountDue,
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
    const subjectText =
      t?.subject ??
      (request?.kind === "reminder"
        ? "Reminder: your {item_name} is ready for pickup"
        : "Your {item_name} at {shop_name}");
    setBody(renderTemplate(text, vars));
    setSubject(renderTemplate(subjectText, vars));
    // The ticket's details show in blue in the editors (decision 146).
    const values: Record<string, string> = Object.fromEntries(
      Object.entries(vars).map(([k, v]) => [k, String(v)]),
    );
    setValues(values);
    const show = (f: string) => values[f] ?? null;
    setBodySegs(parseTemplate(text, show));
    setSubjectSegs(parseTemplate(subjectText, show));
    setEditorKey((k) => k + 1);
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
  // The chosen channel needs shop setup first: the message is greyed out and
  // there's no Send button (Oz, 29 Oct).
  const setupNeeded = shopBlocked(channel);
  // Both need it: one link, at the bottom, so it reads as one thing to do.
  const bothNeedSetup = shopBlocked("sms") && shopBlocked("email");
  const word = channel === "sms" ? "text" : "email";
  const first = data ? data.customer.name.split(" ")[0] || data.customer.name : "";

  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-h-[92svh] overflow-y-auto bg-background text-foreground sm:max-w-xl"
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
                // Opted out or no number/address: darkened, can't be picked.
                const off = customerBlocked(data, ch);
                const Icon = ch === "sms" ? MessageSquare : Mail;
                const verb = ch === "sms" ? "text" : "email";
                return (
                  <label
                    key={ch}
                    className={cn(
                      "flex min-h-11 items-center gap-2 rounded-md border px-3 py-2",
                      off
                        ? "cursor-not-allowed border-border bg-border/60"
                        : "cursor-pointer bg-card",
                      channel === ch && !off
                        ? "border-primary ring-2 ring-primary/30"
                        : "border-border",
                    )}
                  >
                    <input
                      type="radio"
                      name="channel"
                      className="sr-only"
                      value={ch}
                      checked={channel === ch}
                      disabled={!!off}
                      onChange={() => {
                        setChannel(ch);
                        if (!edited) fill(data, ch);
                      }}
                    />
                    <Icon className="size-5 shrink-0" aria-hidden />
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium">{ch === "sms" ? "Text" : "Email"}</span>
                      <span
                        className={cn(
                          "text-sm break-words [overflow-wrap:anywhere]",
                          off ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {off ? (
                          off
                        ) : shopBlocked(ch) ? (
                          bothNeedSetup ? (
                            `Finish setting up your shop to ${verb} customers.`
                          ) : (
                            <>
                              Finish setting up your shop in{" "}
                              <Link
                                to="/app/settings/shop"
                                hash={missingFor(ch)[0] ?? ""}
                                onClick={() => onClose()}
                                className="font-medium text-primary underline underline-offset-4"
                              >
                                settings
                              </Link>{" "}
                              to {verb} customers.
                            </>
                          )
                        ) : ch === "sms" ? (
                          data.phone
                        ) : (
                          data.email
                        )}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            {channel === "email" ? (
              <div className="flex flex-col gap-2">
                <span id="nd-subject-label" className="text-sm font-medium">
                  Subject
                </span>
                <TokenEditor
                  id="nd-subject"
                  labelId="nd-subject-label"
                  singleLine
                  disabled={setupNeeded}
                  value={subjectSegs}
                  resetKey={editorKey}
                  options={fieldOptions}
                  onChange={(segs) => {
                    setSubject(toPlain(segs));
                    setEdited(true);
                  }}
                />
              </div>
            ) : null}
            <div className="flex flex-col gap-2">
              <span id="nd-body-label" className="text-sm font-medium">
                Message
              </span>
              <TokenEditor
                id="nd-body"
                labelId="nd-body-label"
                disabled={setupNeeded}
                rows={5}
                value={bodySegs}
                resetKey={editorKey}
                options={fieldOptions}
                onChange={(segs) => {
                  setBody(toPlain(segs));
                  setEdited(true);
                }}
              />
              <p
                className={cn(
                  "text-sm",
                  body.length > 1600 ? "text-danger" : "text-muted-foreground",
                )}
              >
                {channel === "sms"
                  ? `${seg.units} of ${seg.perSegment * seg.segments} characters · ${seg.segments} text${seg.segments > 1 ? "s" : ""}${seg.encoding === "UCS-2" ? " (special characters use more space)" : ""}. A customer's first text adds "Reply STOP to opt out. Shop info:" and a link to your shop's contact page.`
                  : `${body.length} of 1600 characters`}
              </p>
            </div>
            {setupNeeded && bothNeedSetup ? (
              // One place to finish setup (Oz, 29 Oct).
              <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground">
                We need a few more details about your shop before you can contact customers: your{" "}
                {listWords(shopAttention(shop).map((f) => FIELD_WORDS[f]))}.{" "}
                <Link
                  to="/app/settings/shop"
                  hash={shopAttention(shop)[0] ?? ""}
                  onClick={() => onClose()}
                  className="font-medium text-primary underline underline-offset-4"
                >
                  Finish setting up
                </Link>
              </div>
            ) : !setupNeeded && channel === "email" && shop.email ? (
              <p className="text-sm text-muted-foreground">Replies go to {shop.email}.</p>
            ) : null}

            {error ? <FormAlert tone="error">{error}</FormAlert> : null}
            {/* No Skip: the ✕ closes it (Oz, 29 Oct). No Send until the shop is set up. */}
            {setupNeeded ? null : (
              <div className="flex justify-end gap-3">
                <Button
                  type="submit"
                  disabled={
                    sending ||
                    !!blocked ||
                    !body.trim() ||
                    body.length > 1600 ||
                    plan.mode === "full"
                  }
                >
                  {plan.mode === "send" ? <Send /> : <CalendarClock />}{" "}
                  {sending
                    ? "Sending…"
                    : plan.mode === "full"
                      ? "1 scheduled"
                      : `${plan.mode === "schedule" ? "Schedule" : "Send"} ${word}${repeat ? " again" : ""}`}
                </Button>
              </div>
            )}
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

// How the missing shop details read to a person (Oz, 29 Oct).
const FIELD_WORDS: Record<AttentionField, string> = {
  address: "address",
  phone: "phone number",
  email: "email",
};

/** "a", "a and b", "a, b and c". */
function listWords(words: string[]): string {
  return words.length < 2
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
