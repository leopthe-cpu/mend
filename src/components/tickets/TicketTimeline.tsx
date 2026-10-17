import { useState } from "react";

import { Panel } from "@/components/app/Field";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { APPROVAL_LABEL, type ApprovalMethod, KIND_LABEL, type PaymentKind } from "@/lib/estimates";
import { formatMoney } from "@/lib/money";
import { friendlyDbError } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import type { Ticket } from "@/lib/tickets";

type Event = {
  id: string;
  type: string;
  actor_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
};

export function eventText(e: Event, currency: string): string {
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
    case "message":
      return messageEventText(d);
    case "estimate":
      return estimateEventText(d, currency);
    case "payment":
      return paymentEventText(d, currency);
    default:
      return e.type;
  }
}

function messageEventText(d: Record<string, unknown>): string {
  const ch = d["channel"] === "email" ? "Email" : "Text";
  switch (d["action"]) {
    case "queued":
      return d["kind"] === "reminder" ? `${ch} reminder confirmed` : `${ch} confirmed`;
    case "sent":
      return `${ch} sent`;
    case "failed":
      return `${ch} failed${d["error"] ? `: ${String(d["error"])}` : ""}`;
    case "canceled":
      return `${ch} canceled`;
    case "sms_opt_out":
      return d["source"] === "stop"
        ? "Customer replied STOP: texts are off. Call or email instead."
        : "Texts turned off for this customer";
    default:
      return `${ch} updated`;
  }
}

function estimateEventText(d: Record<string, unknown>, currency: string): string {
  const money = (c: unknown) => formatMoney(Number(c ?? 0), currency);
  // "Quote" is the shop-facing name for an estimate (decision 83).
  const v = Number(d["version"] ?? 1) > 1 ? ` (v${d["version"]})` : "";
  switch (d["action"]) {
    case "started":
      return `Quote started${v}`;
    case "revised":
      return `Services changed: new quote${v}`;
    case "sent":
      return `Quote sent${v} · ${money(d["total_cents"])}`;
    case "approved":
      return `Customer approved the quote${v}${
        d["approval_method"] ? ` ${APPROVAL_LABEL[d["approval_method"] as ApprovalMethod]}` : ""
      } · ${money(d["total_cents"])}`;
    case "declined":
      return `Customer declined the quote${v}`;
    case "invoiced":
      return `Invoice #${d["invoice_number"]} issued · ${money(d["total_cents"])}`;
    default:
      return "Quote updated";
  }
}

function paymentEventText(d: Record<string, unknown>, currency: string): string {
  const money = (c: unknown) => formatMoney(Number(c ?? 0), currency);
  const kind = KIND_LABEL[(d["kind"] as PaymentKind) ?? "payment"] ?? "Payment";
  const verb =
    d["action"] === "edited" ? "edited" : d["action"] === "deleted" ? "deleted" : "recorded";
  return `${kind} of ${money(d["amount_cents"])} ${verb}`;
}

export function TicketTimeline({
  ticket,
  events,
  currency,
  timeZone,
  who,
  onReload,
}: {
  ticket: Ticket;
  events: Event[];
  currency: string;
  timeZone: string;
  who: (id: string | null) => string;
  onReload: () => void;
}) {
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await getSupabase().rpc("add_ticket_note", {
      p_ticket_id: ticket.id,
      p_body: note,
    });
    if (error) {
      setMsg(friendlyDbError(error));
    } else {
      setNote("");
      setMsg(null);
      onReload();
    }
  }

  return (
    <Panel title="Timeline">
      {msg ? <p className="mb-4 text-sm text-danger">{msg}</p> : null}
      <form method="post" onSubmit={addNote} className="mb-4 flex flex-col gap-2">
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
            <p className={e.type === "note" ? "whitespace-pre-wrap" : ""}>
              {eventText(e, currency)}
            </p>
            <p className="font-mono text-sm text-muted-foreground">
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone,
              }).format(new Date(e.created_at))}{" "}
              · {who(e.actor_id)}
            </p>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
