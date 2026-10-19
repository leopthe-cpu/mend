import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { TicketViewSwitch } from "@/components/tickets/TicketViewSwitch";
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
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-[1.75rem] leading-tight font-semibold">
          Tickets{" "}
          <span className="font-medium text-muted-foreground">
            {view === "week" ? weekLabel(anchor) : monthLabel(anchor)}
          </span>
        </h1>
        <TicketViewSwitch current="/app/tickets/calendar" />
        <div role="group" aria-label="View" className="flex rounded-full bg-card p-1">
          {(["week", "month"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => go({ view: v })}
              className={cn(
                "h-10 cursor-pointer rounded-full px-5 text-[0.9375rem] font-medium capitalize",
                view === v ? "bg-foreground text-background" : "text-foreground",
              )}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="icon"
            className="bg-card"
            aria-label={view === "week" ? "Previous week" : "Previous month"}
            onClick={() => step(-1)}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button variant="outline" onClick={() => go({ d: today })}>
            Today
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="bg-card"
            aria-label={view === "week" ? "Next week" : "Next month"}
            onClick={() => step(1)}
          >
            <ChevronRight aria-hidden />
          </Button>
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
          className="grid gap-3 rounded-[1.75rem] bg-card p-3 md:grid-cols-7 md:p-4"
        >
          {weekDays(anchor).map((iso) => {
            const list = perDay.get(iso) ?? [];
            const closed = !isOpenOn(schedule, iso);
            const isToday = iso === today;
            return (
              <div
                key={iso}
                className={cn(
                  "flex min-w-0 flex-col gap-2 rounded-3xl p-3 md:min-h-[28rem]",
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
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-sm",
                      isToday ? "bg-primary text-primary-foreground" : "bg-card",
                    )}
                  >
                    {closed && !list.length ? "Closed" : rows ? ticketCount(list.length) : "…"}
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
                      <span className="truncate font-medium">{t.item_name}</span>
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
              const n = perDay.get(iso)?.length ?? 0;
              const closed = !isOpenOn(schedule, iso);
              const late = (perDay.get(iso) ?? []).filter((t) =>
                isOverdue(t, statusById.get(t.status_id), today),
              ).length;
              const busy = n >= 6 ? "dark" : n >= 4 ? "mid" : "low";
              return (
                <Link
                  key={iso}
                  to="/app/tickets/calendar"
                  search={{ view: "week", d: iso }}
                  aria-label={`${weekdayShort(iso)} ${dayOfMonth(iso)}: ${closed && !n ? "closed" : ticketCount(n)}${late ? `, ${late} late` : ""}`}
                  className={cn(
                    "flex min-h-16 flex-col justify-between rounded-2xl border-2 p-1.5 md:min-h-28 md:p-3",
                    iso === today ? "border-primary" : "border-transparent",
                    !inMonth && "opacity-45",
                    closed && !n
                      ? "bg-background/60 text-muted-foreground"
                      : busy === "dark"
                        ? "bg-foreground text-background"
                        : busy === "mid"
                          ? "bg-primary/15"
                          : "bg-background",
                  )}
                >
                  <span className="text-base font-semibold md:text-lg">{dayOfMonth(iso)}</span>
                  {/* Computers: the customers due that day (19 Oct feedback,
                      item 6), first three and "+N more". Phones: the count. */}
                  {n ? (
                    <span aria-hidden className="hidden min-w-0 flex-col text-sm md:flex">
                      {(perDay.get(iso) ?? []).slice(0, 3).map((t) => (
                        <span key={t.id} className="truncate">
                          {t.customer?.name ?? `#${t.ticket_number}`}
                        </span>
                      ))}
                      {n > 3 ? <span className="opacity-75">+{n - 3} more</span> : null}
                    </span>
                  ) : null}
                  <span className="flex flex-col text-xs md:text-[0.9375rem]">
                    <span className="font-medium">
                      {closed && !n ? (
                        <span className="hidden md:inline">Closed</span>
                      ) : n ? (
                        <span className="md:hidden">{n}</span>
                      ) : null}
                    </span>
                    {late ? (
                      <span
                        aria-hidden
                        className={cn(
                          "font-bold md:hidden",
                          busy === "dark" ? "text-[#FFB4AB]" : "text-danger",
                        )}
                      >
                        !
                      </span>
                    ) : null}
                    {late ? (
                      <span
                        className={cn(
                          "hidden md:inline",
                          busy === "dark" ? "text-[#FFB4AB]" : "text-danger",
                        )}
                      >
                        {late} late
                      </span>
                    ) : null}
                  </span>
                </Link>
              );
            })}
          </div>
          <p className="mt-3 px-1 text-sm text-muted-foreground">
            Darker days have more tickets. Pick a day to see its week.
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
