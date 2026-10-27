import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  Clock,
  Image as ImageIcon,
  MessageSquareWarning,
} from "lucide-react";

import { shortDate } from "@/lib/calendar";
import {
  initials,
  isOverdue,
  isUnclaimed,
  shopToday,
  type ReadyContact,
  type Status,
  type Ticket,
} from "@/lib/tickets";
import { cn } from "@/lib/utils";

/** One ticket on the Board; also drawn under the pointer while it's dragged (decision 111). */
export function BoardCard({
  ticket: t,
  status,
  today,
  unclaimedDays,
  thumb,
  assignee,
  contact,
  timeZone,
  onRemind,
  onTell,
  className,
}: {
  ticket: Ticket;
  status: Status;
  today: string;
  unclaimedDays: number;
  thumb: string | undefined;
  assignee: string;
  /** Ready tickets only: did the customer hear it's ready (Oz, 23 Oct)? */
  contact?: ReadyContact;
  /** Shop time zone, for the day a message went out. */
  timeZone?: string;
  onRemind?: () => void;
  /** Opens the message dialog to tell the customer it's ready. */
  onTell?: () => void;
  className?: string;
}) {
  const overdue = isOverdue(t, status, today);
  const unclaimed = isUnclaimed(t, status, unclaimedDays);
  return (
    <div className={cn("rounded-lg border border-border bg-card p-3", className)}>
      <div className="flex gap-3">
        {thumb ? (
          <img
            src={thumb}
            alt=""
            className="size-14 shrink-0 rounded-lg object-cover [-webkit-user-drag:none]"
            loading="lazy"
            draggable={false}
          />
        ) : null}
        <Link
          to="/app/tickets/$ticketId"
          params={{ ticketId: t.id }}
          draggable={false}
          className="min-w-0 flex-1 rounded-lg [-webkit-user-drag:none]"
        >
          <span className={cn(CHIP, "font-mono")}>#{t.ticket_number}</span>
          <div className="truncate font-semibold">{t.customer?.name}</div>
          <div className="truncate">{t.item_name}</div>
        </Link>
        {assignee ? (
          <span
            title={assignee}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background font-mono text-sm"
          >
            {initials(assignee)}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        {t.promised_date ? (
          <span className={CHIP}>Due {shortDate(t.promised_date, today)}</span>
        ) : null}
        {status.category === "ready" && contact ? (
          <ContactTag
            contact={contact}
            today={today}
            timeZone={timeZone}
            ticketNumber={t.ticket_number}
            onTell={onTell}
          />
        ) : null}
        {thumb ? (
          <ImageIcon className="size-4 text-muted-foreground" aria-label="Has photos" />
        ) : null}
        {overdue ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-status-overdue px-2 font-medium text-danger">
            <AlertTriangle className="size-3.5" aria-hidden /> Overdue
          </span>
        ) : null}
        {unclaimed ? (
          <button
            type="button"
            className="inline-flex min-h-8 items-center gap-1 rounded-full border border-status-waiting px-2 font-medium text-warning hover:bg-status-waiting/10"
            onClick={onRemind}
            aria-label={`Unclaimed: send #${t.ticket_number} a pickup reminder`}
          >
            <Bell className="size-3.5" aria-hidden /> Unclaimed · Send reminder
          </button>
        ) : null}
      </div>
    </div>
  );
}

// Ticket number and dates sit in chips (Oz, 23 Oct). Grey on the white card
// (decision 140); colours from the contrast list (secondary text on surfaces).
const CHIP =
  "inline-flex items-center rounded-full bg-background px-2 py-0.5 text-sm text-muted-foreground tabular-nums";

/**
 * Ready cards say whether the customer was told (Oz, 23 Oct): "Not told yet"
 * and a failed message are buttons that open the message dialog; a sent one
 * names the channel and day. Always a label and an icon, never colour alone.
 */
function ContactTag({
  contact,
  today,
  timeZone,
  ticketNumber,
  onTell,
}: {
  contact: ReadyContact;
  today: string;
  timeZone: string | undefined;
  ticketNumber: number;
  onTell: (() => void) | undefined;
}) {
  if (contact.state === "none" || contact.state === "failed") {
    const failed = contact.state === "failed";
    const label = failed ? "Message failed · Try again" : "Not told yet · Tell them";
    const tone = failed
      ? "border-status-overdue text-danger hover:bg-status-overdue/10"
      : "border-status-waiting text-warning hover:bg-status-waiting/10";
    return onTell ? (
      <button
        type="button"
        className={cn(
          "inline-flex min-h-8 items-center gap-1 rounded-full border px-2 font-medium",
          tone,
        )}
        onClick={onTell}
        aria-label={`${failed ? "Message failed" : "Not told it's ready"}: message #${ticketNumber}`}
      >
        <MessageSquareWarning className="size-3.5" aria-hidden /> {label}
      </button>
    ) : (
      <span className={cn("inline-flex items-center gap-1 rounded-full border px-2", tone)}>
        <MessageSquareWarning className="size-3.5" aria-hidden />{" "}
        {failed ? "Message failed" : "Not told yet"}
      </span>
    );
  }
  const how = contact.channel === "sms" ? "Texted" : "Emailed";
  if (contact.state === "pending")
    return (
      <span className={cn(CHIP, "gap-1")}>
        <Clock className="size-3.5" aria-hidden /> {how === "Texted" ? "Text" : "Email"} waiting to
        send
      </span>
    );
  const day = timeZone ? shopToday(timeZone, new Date(contact.at)) : null;
  return (
    <span className={cn(CHIP, "gap-1 text-success")}>
      <CheckCheck className="size-3.5" aria-hidden /> {how}
      {day ? ` ${shortDate(day, today)}` : ""}
    </span>
  );
}
