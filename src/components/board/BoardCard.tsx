import { Link } from "@tanstack/react-router";
import { AlertTriangle, Bell, Clock, Hourglass, Image as ImageIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { PlaneCrashed, PlaneDown, PlaneFlying } from "@/components/board/PlaneIcons";
import { shortDate } from "@/lib/calendar";
import {
  isDueSoon,
  isOverdue,
  isUnclaimed,
  shopToday,
  type MessagePlane,
  type Status,
  type Ticket,
} from "@/lib/tickets";
import { cn } from "@/lib/utils";

/**
 * One ticket on the Board; also drawn under the pointer while it's dragged
 * (decision 111). Layout from Oz, 27 Oct (decision 142): name and ticket
 * number on top, the job in the middle (three lines, the last fading out),
 * flags and the photo count bottom left, the message icon bottom right.
 */
export function BoardCard({
  ticket: t,
  status,
  today,
  unclaimedDays,
  photos,
  plane,
  timeZone,
  onRemind,
  onCompose,
  finished,
  className,
}: {
  ticket: Ticket;
  status: Status;
  today: string;
  unclaimedDays: number;
  /** How many photos the ticket has. */
  photos: number;
  plane: MessagePlane;
  /** Shop time zone, for the day a message went out. */
  timeZone?: string;
  onRemind?: () => void;
  /** Opens the message dialog (grey icon). */
  onCompose?: () => void;
  /** In the finished column: drawn grey, the job is done (decision 145). */
  finished?: boolean;
  className?: string;
}) {
  const overdue = isOverdue(t, status, today);
  const dueSoon = isDueSoon(t, status, today);
  const unclaimed = isUnclaimed(t, status, unclaimedDays);
  // Flagged cards (Oz, 27 Oct): red border once overdue, yellow when due
  // today or tomorrow and not Ready yet; the chips below carry label and icon.
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        finished ? "bg-background" : "bg-card",
        overdue ? "border-status-overdue" : dueSoon ? "border-status-waiting" : "border-border",
        className,
      )}
    >
      <Link
        to="/app/tickets/$ticketId"
        params={{ ticketId: t.id }}
        draggable={false}
        className="block rounded-lg [-webkit-user-drag:none]"
      >
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate font-semibold">{t.customer?.name}</span>
          <span className={cn(CHIP, "shrink-0 font-mono")}>#{t.ticket_number}</span>
        </div>
        <FadeClamp>
          <span className="font-medium">{t.item_name}</span>
          {t.issue_description ? (
            <span className="text-muted-foreground"> {t.issue_description}</span>
          ) : null}
        </FadeClamp>
      </Link>
      <div className="mt-2 flex min-h-8 flex-wrap items-center gap-2 text-sm">
        {overdue ? (
          <span className={cn(FLAG, "border-status-overdue text-danger")}>
            <AlertTriangle className="size-3.5" aria-hidden /> Overdue
          </span>
        ) : dueSoon ? (
          <span className={cn(FLAG, "border-status-waiting text-warning")}>
            <Clock className="size-3.5" aria-hidden /> Due{" "}
            {t.promised_date === today ? "today" : "tomorrow"}
          </span>
        ) : null}
        {unclaimed ? (
          <button
            type="button"
            className={cn(FLAG, "border-status-waiting text-warning hover:bg-status-waiting/10")}
            onClick={onRemind}
            aria-label={`Unclaimed: send #${t.ticket_number} a pickup reminder`}
          >
            <Bell className="size-3.5" aria-hidden /> Unclaimed · Send reminder
          </button>
        ) : null}
        {photos ? (
          <Link
            to="/app/tickets/$ticketId"
            params={{ ticketId: t.id }}
            hash="photos"
            draggable={false}
            title={`${photos} photo${photos === 1 ? "" : "s"}`}
            aria-label={`#${t.ticket_number}: ${photos} photo${photos === 1 ? "" : "s"}, open them`}
            className="inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-muted-foreground tabular-nums hover:bg-background [-webkit-user-drag:none]"
          >
            <ImageIcon className="size-4" aria-hidden /> {photos}
          </Link>
        ) : null}
        <PlaneButton
          plane={plane}
          status={status}
          ticket={t}
          today={today}
          timeZone={timeZone}
          onCompose={onCompose}
        />
      </div>
    </div>
  );
}

// Ticket number in a chip (Oz, 23 Oct); grey on the white card (decision 140).
const CHIP =
  "inline-flex items-center rounded-full bg-background px-2 py-0.5 text-sm text-muted-foreground tabular-nums";
const FLAG = "inline-flex min-h-7 items-center gap-1 rounded-full border px-2 font-medium";

/**
 * Up to three lines of the job; when there's more, the last line fades out
 * and the rest is on the ticket (Oz, 27 Oct). The fade only appears when the
 * text is actually cut.
 */
function FadeClamp({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setCut(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);
  return (
    <div
      ref={ref}
      className="mt-1 max-h-[4.5em] overflow-hidden leading-normal"
      style={
        cut
          ? {
              maskImage: "linear-gradient(to bottom, #000 calc(100% - 1.5em), transparent)",
              WebkitMaskImage: "linear-gradient(to bottom, #000 calc(100% - 1.5em), transparent)",
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

const PLANE_TONE: Record<MessagePlane["state"], string> = {
  grey: "text-status-closed",
  blue: "text-primary",
  green: "text-success",
  red: "text-danger",
};

/**
 * The message icon, bottom right (decision 142). Grey opens the message
 * dialog; the others open the ticket's Messages. What it means is in its
 * label (hover and screen readers), so colour is never the only signal.
 */
function PlaneButton({
  plane,
  status,
  ticket: t,
  today,
  timeZone,
  onCompose,
}: {
  plane: MessagePlane;
  status: Status;
  ticket: Ticket;
  today: string;
  timeZone: string | undefined;
  onCompose: (() => void) | undefined;
}) {
  const before = plane.count ? ` · ${plane.count} sent before` : "";
  const label =
    plane.state === "grey"
      ? status.notify_by_default
        ? `${status.name} message not sent yet${before}`
        : `Customer not contacted yet${before}`
      : plane.state === "blue"
        ? `Message waiting to send${before}`
        : plane.state === "red"
          ? `Last message failed${before}`
          : `${plane.last?.channel === "email" ? "Emailed" : "Texted"} ${
              plane.last && timeZone
                ? shortDate(shopToday(timeZone, new Date(plane.last.at)), today)
                : ""
            }${plane.count ? ` · ${plane.count} messages sent` : ""}`.trim();
  const Icon =
    plane.state === "grey"
      ? PlaneDown
      : plane.state === "blue"
        ? Hourglass
        : plane.state === "red"
          ? PlaneCrashed
          : PlaneFlying;
  const inner = (
    <>
      <Icon className="size-5" />
      {plane.count ? <span className="font-semibold tabular-nums">{plane.count}</span> : null}
    </>
  );
  const cls = cn(
    "-my-2 -mr-2 ml-auto inline-flex min-h-11 min-w-11 items-center justify-center gap-0.5 rounded-full px-1.5 hover:bg-background",
    PLANE_TONE[plane.state],
  );
  const aria = `#${t.ticket_number}: ${label}`;
  return plane.state === "grey" && onCompose ? (
    <button type="button" onClick={onCompose} title={label} aria-label={aria} className={cls}>
      {inner}
    </button>
  ) : (
    <Link
      to="/app/tickets/$ticketId"
      params={{ ticketId: t.id }}
      hash="messages"
      draggable={false}
      title={label}
      aria-label={aria}
      className={cn(cls, "[-webkit-user-drag:none]")}
    >
      {inner}
    </Link>
  );
}
