import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { TicketViewSwitch } from "@/components/tickets/TicketViewSwitch";
import { boardSummary } from "@/lib/boardSummary";
import type { Membership } from "@/lib/shop";
import { fetchStatuses, fetchTickets, shopToday, type Status, type Ticket } from "@/lib/tickets";
import { cn } from "@/lib/utils";

// The top of every ticket view: Board, Calendar, List (19 Oct round 2, items
// 4, 6 and 11; decision 114). Row 1: "Tickets", the view switch right after
// it (so it never moves between views), the view's own controls on the right
// and the summary toggle. Row 2: one line of tiles, each opening the tickets
// it counts; hidden or shown for all views at once, remembered per browser.

type View = "/app/board" | "/app/tickets/calendar" | "/app/tickets";
const TILES_KEY = "mend:tilesHidden";

function readHidden(): boolean {
  try {
    return localStorage.getItem(TILES_KEY) === "1";
  } catch {
    return false;
  }
}

export function TicketsTop({
  current,
  membership,
  tickets,
  statuses,
  selfLoad = true,
  controls,
}: {
  current: View;
  membership: Membership;
  /** Passed by views that already load them (Board, List); undefined while loading. */
  tickets?: Ticket[] | undefined;
  statuses?: Status[] | undefined;
  /** False when the view passes tickets and statuses itself (no second copy is fetched). */
  selfLoad?: boolean;
  /** The view's own controls (Calendar: period, Week / Month, ‹ Today ›). */
  controls?: ReactNode;
}) {
  const [hidden, setHidden] = useState(readHidden);
  const toggle = () => {
    setHidden((h) => {
      try {
        localStorage.setItem(TILES_KEY, h ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !h;
    });
  };
  return (
    <div className="mb-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[1.75rem] leading-tight font-semibold">Tickets</h1>
        <TicketViewSwitch current={current} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {controls}
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!hidden}
            aria-controls="ticket-tiles"
            className="flex h-10 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[0.9375rem] font-medium text-muted-foreground hover:bg-card hover:text-foreground"
          >
            {hidden ? "Show summary" : "Hide summary"}
            <ChevronDown
              aria-hidden
              className={cn("size-4 transition-transform", !hidden && "rotate-180")}
            />
          </button>
        </div>
      </div>
      {hidden ? null : (
        <Tiles membership={membership} tickets={tickets} statuses={statuses} selfLoad={selfLoad} />
      )}
    </div>
  );
}

function Tiles({
  membership,
  tickets: given,
  statuses: givenStatuses,
  selfLoad,
}: {
  membership: Membership;
  tickets?: Ticket[] | undefined;
  statuses?: Status[] | undefined;
  selfLoad: boolean;
}) {
  const shop = membership.shop;
  const [loaded, setLoaded] = useState<{ tickets: Ticket[]; statuses: Status[] } | null>(null);
  const needLoad = selfLoad && (!given || !givenStatuses);
  useEffect(() => {
    if (!needLoad) return;
    let stale = false;
    void Promise.all([fetchTickets(shop.id), fetchStatuses(shop.id)]).then(([t, s]) => {
      if (!stale) setLoaded({ tickets: t, statuses: s });
    });
    return () => {
      stale = true;
    };
  }, [needLoad, shop.id]);
  const tickets = given ?? loaded?.tickets;
  const statuses = givenStatuses ?? loaded?.statuses;
  const today = shopToday(shop.time_zone);
  const s = useMemo(
    () =>
      tickets && statuses
        ? boardSummary(
            tickets,
            statuses,
            today,
            shop.unclaimed_reminder_days,
            shop.business_hours?.schedule,
          )
        : null,
    [tickets, statuses, today, shop.unclaimed_reminder_days, shop.business_hours?.schedule],
  );
  const ids = (pick: (st: Status) => boolean) =>
    (statuses ?? [])
      .filter((st) => !st.is_final && pick(st))
      .map((st) => `status:${st.id}`)
      .join(",");
  const max = Math.max(1, ...(s?.week ?? []).map((d) => d.count));

  return (
    <section
      id="ticket-tiles"
      aria-label="Summary"
      // One row at every width (decision 118): the tiles share the width and
      // never go below 12 rem; when five don't fit (phones, tablets, small
      // windows) the row swipes sideways instead of wrapping to a second row.
      className="flex snap-x gap-3 overflow-x-auto pb-1"
    >
      <Tile
        label="Due today"
        icon={<Clock aria-hidden className="size-4" />}
        value={s?.dueToday}
        note={s ? (s.notStartedToday ? `${s.notStartedToday} not started yet` : "All started") : ""}
        to="/app/tickets"
        f="flag:today"
      />
      <Tile
        label="Overdue"
        icon={<AlertTriangle aria-hidden className="size-4 text-danger" />}
        value={s?.overdue}
        note="Past their Ready-by date"
        to="/app/tickets"
        f="flag:overdue"
        alert={!!s?.overdue}
      />
      <Tile
        label="In progress"
        icon={<Wrench aria-hidden className="size-4" />}
        value={s?.inProgress}
        note={
          s
            ? s.people
              ? `Across ${s.people} ${s.people === 1 ? "person" : "people"}`
              : "Not assigned"
            : ""
        }
        to="/app/tickets"
        f={ids((st) => st.color === "in-progress")}
      />
      <Tile
        dark
        label="Ready for pickup"
        icon={<CheckCircle2 aria-hidden className="size-4" />}
        value={s?.ready}
        note={
          s
            ? s.unclaimed
              ? `${s.unclaimed} waiting over ${shop.unclaimed_reminder_days} days`
              : "None waiting long"
            : ""
        }
        to="/app/tickets"
        f={ids((st) => st.category === "ready")}
      />
      <Link
        to="/app/tickets/calendar"
        search={{ view: "week" }}
        className="flex min-w-[13rem] flex-1 basis-0 snap-start flex-col gap-1 rounded-[1.75rem] bg-primary p-4 text-primary-foreground transition-shadow hover:shadow-md"
      >
        <span className="flex items-center justify-between gap-2 font-medium">
          This week
          <CalendarDays aria-hidden className="size-4" />
        </span>
        <span className="flex items-end justify-between gap-3">
          <span className="text-3xl font-semibold tracking-tight">{s?.weekTotal ?? "…"}</span>
          <span aria-hidden className="flex h-9 items-end gap-1">
            {(s?.week ?? []).map((d) => (
              <span
                key={d.iso}
                className={cn("w-2 rounded-sm", d.iso === today ? "bg-white" : "bg-white/55")}
                style={{ height: `${Math.max(12, (d.count / max) * 100)}%` }}
              />
            ))}
          </span>
        </span>
        <span className="text-sm opacity-90">due · open the calendar</span>
      </Link>
    </section>
  );
}

function Tile({
  label,
  icon,
  value,
  note,
  to,
  f,
  dark,
  alert,
}: {
  label: string;
  icon: ReactNode;
  value: number | undefined;
  note: string;
  to: "/app/tickets";
  f: string;
  dark?: boolean;
  alert?: boolean;
}) {
  return (
    <Link
      to={to}
      search={f ? { f } : {}}
      className={cn(
        "flex min-w-[12rem] flex-1 basis-0 snap-start flex-col gap-1 rounded-[1.75rem] p-4 transition-shadow hover:shadow-md",
        dark ? "surface-dark bg-background text-foreground" : "bg-card",
      )}
    >
      <span className="flex items-center justify-between gap-2 font-medium">
        {label}
        {icon}
      </span>
      <span className={cn("text-3xl font-semibold tracking-tight", alert && "text-danger")}>
        {value ?? "…"}
      </span>
      <span className="truncate text-sm text-muted-foreground">{note}</span>
    </Link>
  );
}
