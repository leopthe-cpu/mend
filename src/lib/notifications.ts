// Notification centre (Oz, 23 Oct; decision 134). Everything is worked out
// from data the shop already has (tickets, statuses, messages, ticket events),
// so it is the same for everyone and changes as soon as anyone acts: a to-do
// another person finished is gone for you too, and shows in Activity as
// "Ana sent a reminder to Maria Lopez".

import {
  readyContact,
  type ContactMessage,
  type Member,
  type Status,
  type Ticket,
} from "@/lib/tickets";

/** Hours a ticket sits in Ready before Mend asks "Was it picked up?" (Oz, 23 Oct). */
export const PICKUP_CHECK_HOURS = 24;

export type CentreMessage = ContactMessage & {
  kind: "status" | "reminder" | "manual";
  sent_by: string | null;
};
export type CentreEvent = {
  ticket_id: string;
  type: string;
  actor_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
};

export type Todo =
  | { kind: "tell"; ticket: Ticket; status: Status }
  | { kind: "failed"; ticket: Ticket; status: Status; channel: "sms" | "email" }
  | { kind: "pickup"; ticket: Ticket; status: Status; hours: number };

/**
 * Ready tickets that need someone, one to-do each:
 * - not told it's ready yet ("tell");
 * - the only message since it became Ready failed ("failed");
 * - told, Ready for 24 h or more, and no reminder since ("pickup":
 *   "Was it picked up?" with Mark picked up / Send reminder).
 * A message waiting to send (quiet hours) counts as told.
 */
export function buildTodos(
  tickets: Ticket[],
  statuses: Status[],
  messages: CentreMessage[],
  now = new Date(),
): Todo[] {
  const byId = new Map(statuses.map((s) => [s.id, s]));
  const todos: Todo[] = [];
  for (const t of tickets) {
    const status = byId.get(t.status_id);
    if (!status || status.category !== "ready") continue;
    const contact = readyContact(t, messages);
    if (contact.state === "none") {
      todos.push({ kind: "tell", ticket: t, status });
      continue;
    }
    if (contact.state === "failed") {
      todos.push({ kind: "failed", ticket: t, status, channel: contact.channel });
      continue;
    }
    const since = new Date(t.status_changed_at).getTime();
    const hours = Math.floor((now.getTime() - since) / 3_600_000);
    const reminded = messages.some(
      (m) =>
        m.ticket_id === t.id &&
        m.kind === "reminder" &&
        m.status !== "canceled" &&
        m.status !== "failed" &&
        new Date(m.created_at).getTime() >= since,
    );
    if (hours >= PICKUP_CHECK_HOURS && !reminded)
      todos.push({ kind: "pickup", ticket: t, status, hours });
  }
  // Oldest first: the longest wait is the most urgent.
  return todos.sort((a, b) => a.ticket.status_changed_at.localeCompare(b.ticket.status_changed_at));
}

export type ActivityItem = { at: string; text: string; ticketId: string | null };

/**
 * What people did in the last days, newest first: tickets logged, moved
 * (including picked up), and messages sent or failed, with who did it.
 * Shown in the centre without raising the red count (Oz, 23 Oct).
 */
export function buildActivity(
  events: CentreEvent[],
  messages: CentreMessage[],
  tickets: Ticket[],
  members: Member[],
  limit = 50,
): ActivityItem[] {
  const ticket = new Map(tickets.map((t) => [t.id, t]));
  const who = (id: string | null) =>
    (id && (members.find((m) => m.user_id === id)?.name || "A team member")) || "Mend";
  const ref = (id: string) => {
    const t = ticket.get(id);
    return t ? `#${t.ticket_number} (${t.customer?.name ?? "customer"})` : "a ticket";
  };
  const customer = (id: string) => ticket.get(id)?.customer?.name ?? "a customer";
  const items: ActivityItem[] = [];
  for (const e of events) {
    if (e.type === "created")
      items.push({
        at: e.created_at,
        ticketId: e.ticket_id,
        text: `${who(e.actor_id)} logged ${ref(e.ticket_id)}`,
      });
    else if (e.type === "status_change") {
      const to = typeof e.data["to"] === "string" ? e.data["to"] : "a new status";
      const closed = e.data["to_category"] === "closed";
      items.push({
        at: e.created_at,
        ticketId: e.ticket_id,
        text: closed
          ? `${who(e.actor_id)} marked ${ref(e.ticket_id)} ${to.toLowerCase()}`
          : `${who(e.actor_id)} moved ${ref(e.ticket_id)} to ${to}`,
      });
    }
  }
  for (const m of messages) {
    if (m.status === "queued" || m.status === "sending" || m.status === "canceled") continue;
    const what = m.kind === "reminder" ? "a reminder" : m.channel === "sms" ? "a text" : "an email";
    const num = ticket.get(m.ticket_id)?.ticket_number;
    const suffix = num ? ` (#${num})` : "";
    items.push({
      at: m.created_at,
      ticketId: m.ticket_id,
      text:
        m.status === "failed"
          ? `${who(m.sent_by)}'s ${what.replace(/^an? /, "")} to ${customer(m.ticket_id)}${suffix} failed`
          : `${who(m.sent_by)} sent ${what} to ${customer(m.ticket_id)}${suffix}`,
    });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function ago(iso: string, now = new Date()): string {
  const min = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}
