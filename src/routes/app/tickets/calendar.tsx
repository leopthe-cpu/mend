import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { TicketsTop } from "@/components/tickets/TicketsTop";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  addDays,
  addMonths,
  byDate,
  dayOfMonth,
  monthGrid,
  monthLabel,
  ticketCount,
  weekDays,
  weekdayShort,
  weekLabel,
} from "@/lib/calendar";
import { isOpenOn } from "@/lib/hours";
import { friendlyDbError } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import {
  fetchStatuses,
  isOverdue,
  shopToday,
  STATUS_COLOR_CLASS,
  type Status,
} from "@/lib/tickets";
import { cn } from "@/lib/utils";

// Calendar of open tickets by their Ready-by date (decision 93, mockup
// approved 18 Oct), one of the three Tickets views since 19 Oct (decision
// 101). "Open" = not picked up and not deleted; Ready tickets still show,
// since they are waiting for their customer. Week view lists the tickets per
// day, month view their customers; closed days come from the shop's weekly
// hours. The "due" and "overdue" chips switch to a list grouped by date.

type View = "week" | "month";
type Show = "due" | "overdue";
type CalSearch = { view?: View; d?: string; show?: Show };

export const Route = createFileRoute("/app/tickets/calendar")({
  head: () => ({ meta: [{ title: "Calendar · Mend" }] }),
  validateSearch: (s: Record<string, unknown>): CalSearch => ({
    ...(s["view"] === "month" || s["view"] === "week" ? { view: s["view"] } : {}),
    ...(typeof s["d"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s["d"]) ? { d: s["d"] } : {}),
    ...(s["show"] === "due" || s["show"] === "overdue" ? { show: s["show"] } : {}),
  }),
  component: CalendarPage,
});

type Row = {
  id: string;
  ticket_number: number;
  item_name: string;
  promised_date: string | null;
  status_id: string;
  customer: { name: string } | null;
};

const COLUMNS = "id, ticket_number, item_name, promised_date, status_id, customer:customers(name)";

function CalendarPage() {
  const { membership } = Route.useRouteContext();
  const shop = membership.shop;
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/app/tickets/calendar" });
  const today = shopToday(shop.time_zone);
  const view: View = search.view ?? "week";
  const show = search.show;
  const anchor = search.d ?? today;
  const schedule = shop.business_hours?.schedule;

  const range = useMemo(() => {
    if (view === "week") {
      const days = weekDays(anchor);
      return { from: days[0] ?? anchor, to: days[6] ?? anchor };
    }
    const grid = monthGrid(anchor);
    return { from: grid[0]?.iso ?? anchor, to: grid[grid.length - 1]?.iso ?? anchor };
  }, [view, anchor]);

  const [statuses, setStatuses] = useState<Status[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [lateRows, setLateRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    setRows(null);
    void (async () => {
      try {
        const sb = getSupabase();
        const [s, inRange, before] = await Promise.all([
          fetchStatuses(shop.id),
          sb
            .from("tickets")
            .select(COLUMNS)
            .eq("shop_id", shop.id)
            .is("deleted_at", null)
            .gte("promised_date", range.from)
            .lte("promised_date", range.to)
            .order("ticket_number")
            .limit(2000),
          sb
            .from("tickets")
            .select(COLUMNS)
            .eq("shop_id", shop.id)
            .is("deleted_at", null)
            .lt("promised_date", today)
            .limit(2000),
        ]);
        if (inRange.error) throw inRange.error;
        if (before.error) throw before.error;
        if (stale) return;
        const byId = new Map(s.map((x) => [x.id, x]));
        const open = (r: { status_id: string }) => !byId.get(r.status_id)?.is_final;
        setStatuses(s);
        setRows(((inRange.data ?? []) as unknown as Row[]).filter(open));
        setLateRows(
          ((before.data ?? []) as unknown as Row[])
            .filter((r) => isOverdue(r, byId.get(r.status_id), today))
            .sort((a, b) => (a.promised_date ?? "").localeCompare(b.promised_date ?? "")),
        );
      } catch (e) {
        if (!stale) setError(friendlyDbError(e as { message: string }));
      }
    })();
    return () => {
      stale = true;
    };
  }, [shop.id, range.from, range.to, today]);

  const statusById = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);
  const perDay = useMemo(() => byDate(rows ?? [], (r) => r.promised_date), [rows]);
  const go = (next: { view?: View; d?: string; show?: Show | undefined }) => {
    const m = { view, d: anchor, show, ...next };
    void navigate({ search: { view: m.view, d: m.d, ...(m.show ? { show: m.show } : {}) } });
  };
  const step = (dir: 1 | -1) =>
    go({ d: view === "week" ? addDays(anchor, 7 * dir) : addMonths(anchor, dir) });
  // Month view loads whole weeks; the total counts only that month's days.
  const dueRows = (rows ?? []).filter(
    (r) => view === "week" || r.promised_date?.slice(0, 7) === anchor.slice(0, 7),
  );
  const total = dueRows.length;
  const lateCount = lateRows.length;
  const chip = (active: boolean) =>
    cn(
      "inline-flex h-10 cursor-pointer items-center rounded-full px-4 transition-colors",
      active ? "bg-foreground text-background" : "bg-card hover:bg-border/60",
    );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <TicketsTop current="/app/tickets/calendar" membership={membership} />
        {/* Calendar controls sit below the shared top, so the view switch
            stays in the same place on every view (decision 114). */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="icon"
            className="bg-card"
            aria-label={view === "week" ? "Previous week" : "Previous month"}
            onClick={() => step(-1)}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <h2 className="min-w-44 text-center text-xl font-semibold" aria-live="polite">
            {view === "week" ? weekLabel(anchor) : monthLabel(anchor)}
          </h2>
          <Button
            variant="secondary"
            size="icon"
            className="bg-card"
            aria-label={view === "week" ? "Next week" : "Next month"}
            onClick={() => step(1)}
          >
            <ChevronRight aria-hidden />
          </Button>
          <Button variant="outline" onClick={() => go({ d: today })}>
            Today
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" aria-label={`Show by ${view}`}>
                {view === "week" ? "Week" : "Month"}
                <ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="rounded-lg">
              <DropdownMenuRadioGroup
                value={view}
                onValueChange={(v) => go({ view: v === "month" ? "month" : "week" })}
              >
                <DropdownMenuRadioItem value="week">Week</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="month">Month</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* The chips are filters (19 Oct feedback, item 7): each shows its
          tickets as one list grouped by date; pressing it again goes back. */}
      <div className="flex flex-wrap items-center gap-2" aria-live="polite">
        <button
          type="button"
          aria-pressed={show === "due"}
          className={chip(show === "due")}
          onClick={() => go({ show: show === "due" ? undefined : "due" })}
        >
          <strong className="mr-1.5">{rows ? total : "…"}</strong>
          {view === "week" ? "due this week" : "due this month"}
        </button>
        {lateCount ? (
          <button
            type="button"
            aria-pressed={show === "overdue"}
            className={cn(chip(show === "overdue"), show !== "overdue" && "text-danger")}
            onClick={() => go({ show: show === "overdue" ? undefined : "overdue" })}
          >
            <strong className="mr-1.5">{lateCount}</strong> overdue
          </button>
        ) : null}
        <span className="px-2 text-sm text-muted-foreground">By Ready-by date · open tickets</span>
      </div>

      {error ? <FormAlert tone="error">{error}</FormAlert> : null}

      {show ? (
        <GroupedList
          rows={show === "due" ? dueRows : lateRows}
          statusById={statusById}
          today={today}
          empty={show === "due" ? "Nothing due in this period." : "Nothing is overdue."}
        />
      ) : view === "week" ? (
        <section
          aria-label="Week"
          // Phones: the days stack. Wider screens: seven columns that share the
          // width but never go below 9.5 rem; when they don't fit, the week
          // scrolls sideways inside its card, like the board (decision 119).
          className="flex flex-col gap-3 rounded-[1.75rem] bg-card p-3 md:snap-x md:scroll-px-4 md:flex-row md:overflow-x-auto md:p-4"
        >
          {weekDays(anchor).map((iso) => {
            const list = perDay.get(iso) ?? [];
            const closed = !isOpenOn(schedule, iso);
            const isToday = iso === today;
            return (
              <div
                key={iso}
                className={cn(
                  "flex min-w-0 flex-col gap-2 rounded-3xl p-3 md:min-h-[28rem] md:min-w-[9.5rem] md:flex-1 md:basis-0 md:snap-start",
                  isToday ? "bg-primary/10" : "bg-background",
                )}
              >
                <div className="flex items-start justify-between gap-2 px-1">
                  <span className="flex flex-col">
                    <span className="text-sm text-muted-foreground">{weekdayShort(iso)}</span>
                    <span
                      className={cn("text-2xl font-semibold", isToday && "text-primary")}
                      aria-label={isToday ? `${dayOfMonth(iso)}, today` : undefined}
                    >
                      {dayOfMonth(iso)}
                    </span>
                  </span>
                  {/* The count is just the number in a column ("2 tickets"
                      on phones, where the day spans the screen), so it never
                      wraps. */}
                  <span
                    title={rows ? ticketCount(list.length) : undefined}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-sm whitespace-nowrap",
                      isToday ? "bg-primary text-primary-foreground" : "bg-card",
                    )}
                  >
                    {closed && !list.length ? (
                      "Closed"
                    ) : rows ? (
                      <>
                        <span className="md:hidden">{ticketCount(list.length)}</span>
                        <span className="hidden md:inline" aria-label={ticketCount(list.length)}>
                          {list.length}
                        </span>
                      </>
                    ) : (
                      "…"
                    )}
                  </span>
                </div>
                {list.map((t) => {
                  const st = statusById.get(t.status_id);
                  const late = isOverdue(t, st, today);
                  return (
                    <Link
                      key={t.id}
                      to="/app/tickets/$ticketId"
                      params={{ ticketId: t.id }}
                      className="flex flex-col gap-0.5 rounded-2xl bg-card p-3 hover:ring-2 hover:ring-primary/30"
                    >
                      <span className="truncate text-sm text-muted-foreground">
                        <span className="font-mono">#{t.ticket_number}</span>
                        {t.customer ? ` · ${t.customer.name}` : ""}
                      </span>
                      <span className="line-clamp-2 font-medium">{t.item_name}</span>
                      <span className="flex items-center gap-1.5 text-sm">
                        {late ? (
                          <span className="font-medium text-danger">! Late</span>
                        ) : st ? (
                          <>
                            <span
                              aria-hidden
                              className={cn("size-2 rounded-full", STATUS_COLOR_CLASS[st.color])}
                            />
                            {st.name}
                          </>
                        ) : null}
                      </span>
                    </Link>
                  );
                })}
                {closed && list.length ? (
                  <span className="px-1 text-sm text-muted-foreground">Shop closed</span>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : (
        <section aria-label="Month" className="rounded-[1.75rem] bg-card p-3 md:p-4">
          <div className="grid grid-cols-7 gap-1.5 md:gap-2.5">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => (
              <span key={w} className="px-1 text-sm text-muted-foreground md:px-2">
                {w}
              </span>
            ))}
            {monthGrid(anchor).map(({ iso, inMonth }) => {
              const list = perDay.get(iso) ?? [];
              const n = list.length;
              const closed = !isOpenOn(schedule, iso);
              const late = list.filter((t) =>
                isOverdue(t, statusById.get(t.status_id), today),
              ).length;
              const week = { view: "week" as const, d: iso };
              // Each day lists its tickets as small white cards (19 Oct round
              // 2, item 8; decision 113): first three, then "+N more" opens
              // the week. Phones show the count.
              return (
                <div
                  key={iso}
                  className={cn(
                    "flex min-h-16 min-w-0 flex-col gap-1.5 rounded-2xl border-2 p-1.5 md:min-h-32 md:p-2",
                    iso === today ? "border-primary" : "border-transparent",
                    !inMonth && "opacity-45",
                    closed && !n ? "bg-background/60 text-muted-foreground" : "bg-background",
                  )}
                >
                  <Link
                    to="/app/tickets/calendar"
                    search={week}
                    aria-label={`${weekdayShort(iso)} ${dayOfMonth(iso)}: ${closed && !n ? "closed" : ticketCount(n)}${late ? `, ${late} late` : ""}. Open the week`}
                    className="flex items-baseline justify-between gap-1 rounded-lg px-1 hover:underline"
                  >
                    <span className="text-base font-semibold">{dayOfMonth(iso)}</span>
                    <span className="text-xs md:hidden">
                      {n ? n : ""}
                      {late ? <span className="font-bold text-danger"> !</span> : null}
                    </span>
                    {closed && !n ? <span className="hidden text-sm md:inline">Closed</span> : null}
                  </Link>
                  <ul className="hidden min-w-0 flex-col gap-1 md:flex">
                    {list.slice(0, 3).map((t) => {
                      const st = statusById.get(t.status_id);
                      const isLate = isOverdue(t, st, today);
                      return (
                        <li key={t.id} className="min-w-0">
                          <Link
                            to="/app/tickets/$ticketId"
                            params={{ ticketId: t.id }}
                            title={`#${t.ticket_number} · ${t.customer?.name ?? ""} · ${t.item_name}`}
                            className="flex min-w-0 items-center gap-1.5 rounded-lg bg-card px-2 py-1 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.06)] hover:ring-2 hover:ring-primary/30"
                          >
                            <span
                              aria-hidden
                              className={cn(
                                "size-2 shrink-0 rounded-full",
                                isLate ? "bg-danger" : st ? STATUS_COLOR_CLASS[st.color] : "",
                              )}
                            />
                            <span className="min-w-0 truncate">
                              <span className="font-medium">
                                {t.customer?.name ?? `#${t.ticket_number}`}
                              </span>
                              <span className="text-muted-foreground"> · {t.item_name}</span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                    {n > 3 ? (
                      <li>
                        <Link
                          to="/app/tickets/calendar"
                          search={week}
                          className="px-1 text-sm text-muted-foreground hover:underline"
                        >
                          +{n - 3} more
                        </Link>
                      </li>
                    ) : null}
                  </ul>
                </div>
              );
            })}
          </div>
          <p className="mt-3 px-1 text-sm text-muted-foreground">
            A red dot means late. Pick a day&rsquo;s number to see its week.
          </p>
        </section>
      )}
    </div>
  );
}

/** The chip filters' view: tickets in date order under a heading per day. */
function GroupedList({
  rows,
  statusById,
  today,
  empty,
}: {
  rows: Row[];
  statusById: Map<string, Status>;
  today: string;
  empty: string;
}) {
  const groups = [...byDate(rows, (r) => r.promised_date)].sort(([a], [b]) => a.localeCompare(b));
  if (!groups.length)
    return <p className="rounded-lg bg-card p-6 text-muted-foreground">{empty}</p>;
  return (
    <div className="flex flex-col gap-4">
      {groups.map(([iso, list]) => (
        <section key={iso} aria-label={dayHeading(iso)}>
          <h2 className="mb-2 px-1 font-semibold">
            {dayHeading(iso)}
            <span className="ml-2 font-normal text-muted-foreground">
              {ticketCount(list.length)}
            </span>
          </h2>
          <ul className="divide-y divide-border rounded-lg bg-card">
            {list.map((t) => {
              const st = statusById.get(t.status_id);
              const late = isOverdue(t, st, today);
              return (
                <li key={t.id}>
                  <Link
                    to="/app/tickets/$ticketId"
                    params={{ ticketId: t.id }}
                    className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-background"
                  >
                    <span className="w-16 shrink-0 font-mono text-sm text-muted-foreground">
                      #{t.ticket_number}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{t.customer?.name}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {t.item_name}
                      </span>
                    </span>
                    {late ? (
                      <span className="shrink-0 text-sm font-medium text-danger">Overdue</span>
                    ) : st ? (
                      <span className="flex shrink-0 items-center gap-1.5 text-sm">
                        <span
                          aria-hidden
                          className={cn("size-2 rounded-full", STATUS_COLOR_CLASS[st.color])}
                        />
                        {st.name}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** "Mon, Oct 20" (UTC, so the date never shifts with the viewer's zone). */
function dayHeading(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}
