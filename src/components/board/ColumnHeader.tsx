import { Link } from "@tanstack/react-router";
import { AlertTriangle, Check, Clock, Hourglass, Plus, Send } from "lucide-react";
import { useRef, useState } from "react";

import { BOARD_CLOSED_LIMIT, STATUS_COLOR_CLASS, type Status } from "@/lib/tickets";
import { cn } from "@/lib/utils";

/**
 * One column's header on the board (decisions 145, 147): name, the message
 * icon and the count chip, with its alerts
 * underneath. For Owner and Admin, clicking it opens the column window,
 * the + adds a column to its right, and dragging it reorders the columns.
 * Staff open the List filtered to the column, as before (decision 117).
 */
export function ColumnHeader({
  status: s,
  total,
  late,
  soon,
  idle,
  canEdit,
  last,
  dropBefore,
  dropAfter,
  dragging,
  dragActive,
  onOpen,
  onAdd,
  onDragStart,
}: {
  status: Status;
  total: number;
  late: number;
  soon: number;
  idle: number;
  canEdit: boolean;
  last: boolean;
  /** A column being dragged would land just before / after this one. */
  dropBefore: boolean;
  dropAfter: boolean;
  dragging: boolean;
  /** Some column is being dragged: no + then. */
  dragActive: boolean;
  onOpen: () => void;
  onAdd: () => void;
  onDragStart: (e: React.PointerEvent<HTMLElement>) => void;
}) {
  // The message icon (decision 147): with a check when the column messages
  // customers on arrival, greyed out when it doesn't.
  const label = s.notify_by_default ? "Messages customers on arrival" : "No message on arrival";
  const plane = (
    <span
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-full",
        s.notify_by_default ? "text-primary" : "text-muted-foreground/50",
      )}
      title={label}
    >
      <Send aria-hidden className="size-4" />
      {s.notify_by_default ? (
        <span
          aria-hidden
          className="absolute right-0.5 bottom-0.5 flex size-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-card"
        >
          <Check className="size-2.5" strokeWidth={3} />
        </span>
      ) : null}
      <span className="sr-only">{label}</span>
    </span>
  );
  // The count in a chip, right-most (Oz, 29 Oct).
  const count = (
    <span className="shrink-0 rounded-full bg-background px-2 py-0.5 font-mono group-hover:bg-card text-sm font-normal text-muted-foreground tabular-nums">
      {total}
    </span>
  );
  const dot = (
    <span
      aria-hidden
      className={cn("size-2.5 shrink-0 rounded-full", STATUS_COLOR_CLASS[s.color])}
    />
  );
  // Name and alerts on the left; the count chip with the message icon under
  // it on the right (Oz, 29 Oct).
  const body = (
    <span className="flex w-full items-center gap-3">
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2 font-semibold">
          {dot}
          <span className="truncate">{s.name}</span>
        </span>
        <Alerts status={s} total={total} late={late} soon={soon} idle={idle} />
      </span>
      <span className="flex shrink-0 flex-col items-center gap-0.5">
        {count}
        {plane}
      </span>
    </span>
  );
  return (
    <div
      className={cn(
        "group relative h-[4.75rem] min-w-[17rem] flex-1 basis-0 border-r border-border last:border-r-0",
        dragging && "opacity-40",
        dropBefore && "shadow-[inset_4px_0_0_var(--color-primary)]",
        dropAfter && "shadow-[inset_-4px_0_0_var(--color-primary)]",
      )}
    >
      {canEdit ? (
        <HeaderButton label={`${s.name}: edit column`} onOpen={onOpen} onDragStart={onDragStart}>
          {body}
        </HeaderButton>
      ) : (
        <Link
          to="/app/tickets"
          search={{ f: `status:${s.id}` }}
          title={`See all ${s.name} tickets in the list`}
          className="flex h-full flex-col justify-center gap-1 px-4 pr-3 hover:bg-background"
        >
          {body}
        </Link>
      )}
      {canEdit && !dragActive ? (
        <button
          type="button"
          onClick={onAdd}
          aria-label={`Add a column after ${s.name}`}
          title="Add a column to the right"
          // On the line between this column and the next (inside the last one).
          className={cn(
            "absolute top-1/2 z-10 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 shadow-[0_0_0_3px_var(--color-card)] group-hover:opacity-100 focus-visible:opacity-100",
            last ? "right-1" : "right-0 translate-x-1/2",
          )}
        >
          <Plus aria-hidden className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * The header as one target: a click opens the column window; press and drag
 * (more than a few pixels) to move the column instead. Enter or Space opens it.
 */
function HeaderButton({
  label,
  onOpen,
  onDragStart,
  children,
}: {
  label: string;
  onOpen: () => void;
  onDragStart: (e: React.PointerEvent<HTMLElement>) => void;
  children: React.ReactNode;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [moved, setMoved] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        start.current = { x: e.clientX, y: e.clientY };
        setMoved(false);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s || moved) return;
        if (Math.abs(e.clientX - s.x) + Math.abs(e.clientY - s.y) > 6) {
          setMoved(true);
          start.current = null;
          onDragStart(e);
        }
      }}
      onPointerUp={() => {
        if (start.current && !moved) onOpen();
        start.current = null;
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="flex h-full cursor-pointer touch-none flex-col justify-center gap-1 px-4 pr-3 select-none hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      {children}
    </div>
  );
}

/** Under the name: the column's alerts as pills, or what the finished column shows. */
function Alerts({
  status: s,
  total,
  late,
  soon,
  idle,
}: {
  status: Status;
  total: number;
  late: number;
  soon: number;
  idle: number;
}) {
  if (s.is_final)
    return (
      <span className="text-sm text-muted-foreground">
        Finished{total > BOARD_CLOSED_LIMIT ? ` · latest ${BOARD_CLOSED_LIMIT}` : ""}
      </span>
    );
  if (!late && !soon && !idle) return <span className="h-6" aria-hidden />;
  const pill = "inline-flex items-center gap-1 rounded-full border px-2 text-sm font-medium";
  return (
    <span className="flex flex-wrap gap-1.5 overflow-hidden">
      {late ? (
        <span className={cn(pill, "border-status-overdue text-danger")}>
          <AlertTriangle aria-hidden className="size-3.5" /> {late} overdue
        </span>
      ) : null}
      {soon ? (
        <span className={cn(pill, "border-status-waiting text-warning")}>
          <Clock aria-hidden className="size-3.5" /> {soon} due soon
        </span>
      ) : null}
      {idle ? (
        <span
          className={cn(pill, "border-status-waiting text-warning")}
          title={`Here for more than ${s.idle_alert_days} days`}
        >
          <Hourglass aria-hidden className="size-3.5" /> {idle} idle
        </span>
      ) : null}
    </span>
  );
}
