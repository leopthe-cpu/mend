import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
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
// approved 18 Oct). "Open" = not picked up and not deleted; Ready tickets
// still show, since they are waiting for their customer. Week view lists the
// tickets per day, month view shows how many; closed days come from the
// shop's weekly hours.

type View = "week" | "month";
type CalSearch = { view?: View; d?: string };

export const Route = createFileRoute("/app/calendar")({
  head: () => ({ meta: [{ title: "Calendar · Mend" }] }),
  validateSearch: (s: Record<string, unknown>): CalSearch => ({
    ...(s["view"] === "month" || s["view"] === "week" ? { view: s["view"] } : {}),
    ...(typeof s["d"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s["d"]) ? { d: s["d"] } : {}),
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
  const navigate = useNavigate({ from: "/app/calendar" });
  const today = shopToday(shop.time_zone);
  const view: View = search.view ?? "week";
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
  const [lateCount, setLateCount] = useState(0);
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
            .select("id, promised_date, status_id")
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
        setLateCount(
          (before.data ?? []).filter((r) =>
            isOverdue(
              r as { promised_date: string | null },
              byId.get(r.status_id as string),
              today,
            ),
          ).length,
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
  const go = (next: CalSearch) => void navigate({ search: { view, d: anchor, ...next } });
  const step = (dir: 1 | -1) =>
    go({ d: view === "week" ? addDays(anchor, 7 * dir) : addMonths(anchor, dir) });
  // Month view loads whole weeks; the total counts only that month's days.
  const total = (rows ?? []).filter(
    (r) => view === "week" || r.promised_date?.slice(0, 7) === anchor.slice(0, 7),
  ).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-[1.75rem] leading-tight font-semibold">
          Calendar{" "}
          <span className="font-medium text-muted-foreground">
            {view === "week" ? weekLabel(anchor) : monthLabel(anchor)}
          </span>
        </h1>
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

      <div className="flex flex-wrap gap-2" aria-live="polite">
        <span className="inline-flex h-10 items-center rounded-full bg-card px-4">
          <strong className="mr-1.5">{rows ? total : "…"}</strong>
          {view === "week" ? "due this week" : "due this month"}
        </span>
        {lateCount ? (
          <span className="inline-flex h-10 items-center rounded-full bg-card px-4 text-danger">
            <strong className="mr-1.5">{lateCount}</strong> overdue
          </span>
        ) : null}
        <span className="inline-flex h-10 items-center rounded-full bg-card px-4 text-muted-foreground">
          By Ready-by date · open tickets
        </span>
      </div>

      {error ? <FormAlert tone="error">{error}</FormAlert> : null}

      {view === "week" ? (
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
                  to="/app/calendar"
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
                  <span className="flex flex-col text-xs md:text-[0.9375rem]">
                    <span className="font-medium">
                      {closed && !n ? (
                        <span className="hidden md:inline">Closed</span>
                      ) : n ? (
                        <>
                          <span className="md:hidden">{n}</span>
                          <span className="hidden md:inline">{ticketCount(n)}</span>
                        </>
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
