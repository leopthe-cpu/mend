import { Link } from "@tanstack/react-router";
import { AlertTriangle, Bell, Image as ImageIcon } from "lucide-react";

import { shortDate } from "@/lib/calendar";
import { initials, isOverdue, isUnclaimed, type Status, type Ticket } from "@/lib/tickets";
import { cn } from "@/lib/utils";

/** One ticket on the Board; also drawn under the pointer while it's dragged (decision 111). */
export function BoardCard({
  ticket: t,
  status,
  today,
  unclaimedDays,
  thumb,
  assignee,
  onRemind,
  className,
}: {
  ticket: Ticket;
  status: Status;
  today: string;
  unclaimedDays: number;
  thumb: string | undefined;
  assignee: string;
  onRemind?: () => void;
  className?: string;
}) {
  const overdue = isOverdue(t, status, today);
  const unclaimed = isUnclaimed(t, status, unclaimedDays);
  return (
    <div className={cn("rounded-2xl bg-background p-3", className)}>
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
          <div className="font-mono text-sm text-muted-foreground">#{t.ticket_number}</div>
          <div className="truncate font-semibold">{t.customer?.name}</div>
          <div className="truncate">{t.item_name}</div>
        </Link>
        {assignee ? (
          <span
            title={assignee}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-card font-mono text-sm"
          >
            {initials(assignee)}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        {t.promised_date ? (
          <span className="text-muted-foreground">Due {shortDate(t.promised_date, today)}</span>
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
