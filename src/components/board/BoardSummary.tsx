import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Clock, Wrench } from "lucide-react";
import type { ReactNode } from "react";

import { ticketCount, weekdayShort } from "@/lib/calendar";
import { boardSummary } from "@/lib/boardSummary";
import type { WeeklySchedule } from "@/lib/hours";
import type { Status, Ticket } from "@/lib/tickets";
import { cn } from "@/lib/utils";

// The top of the Board (decision 94, mockup approved 18 Oct): four counts,
// this week's Ready-by load with a link to the calendar, and the tickets
// waiting longest for pickup.

export function BoardSummary({
  tickets,
  statuses,
  today,
  unclaimedDays,
  schedule,
}: {
  tickets: Ticket[];
  statuses: Status[];
  today: string;
  unclaimedDays: number;
  schedule: WeeklySchedule | undefined;
}) {
  const s = boardSummary(tickets, statuses, today, unclaimedDays, schedule);
  const busiest = s.week.reduce<(typeof s.week)[number] | undefined>(
    (a, b) => (!a || b.count > a.count ? b : a),
    undefined,
  );
  const max = Math.max(1, ...s.week.map((d) => d.count));

  return (
    <div className="mb-5 flex flex-col gap-4">
      <section aria-label="At a glance" className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <Stat
          label="Due today"
          icon={<Clock aria-hidden className="size-4" />}
          value={s.dueToday}
          note={s.notStartedToday ? `${s.notStartedToday} not started yet` : "All started"}
        />
        <Stat
          label="In progress"
          icon={<Wrench aria-hidden className="size-4" />}
          value={s.inProgress}
          note={
            s.people ? `Across ${s.people} ${s.people === 1 ? "person" : "people"}` : "Not assigned"
          }
        />
        <Stat
          dark
          label="Ready for pickup"
          icon={<CheckCircle2 aria-hidden className="size-4" />}
          value={s.ready}
          note={
            s.unclaimed ? `${s.unclaimed} waiting over ${unclaimedDays} days` : "None waiting long"
          }
        />
        <Stat
          label="Overdue"
          icon={<AlertTriangle aria-hidden className="size-4 text-danger" />}
          value={s.overdue}
          note="Past their Ready-by date"
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section
          aria-label="This week"
          className="flex flex-col gap-3 rounded-[1.75rem] bg-primary p-5 text-primary-foreground md:p-6"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-xl font-semibold">This week</h2>
            <Link
              to="/app/calendar"
              className="rounded-full text-[0.9375rem] underline underline-offset-4"
            >
              Open calendar
            </Link>
          </div>
          <p>
            <span className="text-4xl font-semibold tracking-tight">{s.weekTotal}</span>{" "}
            <span>{s.weekTotal === 1 ? "ticket" : "tickets"} due</span>
          </p>
          <ol className="grid h-28 grid-cols-7 items-end gap-1.5" aria-label="Tickets due per day">
            {s.week.map((d) => (
              <li
                key={d.iso}
                className="flex h-full flex-col items-center justify-end gap-1"
                aria-label={`${weekdayShort(d.iso)}: ${d.closed && !d.count ? "closed" : ticketCount(d.count)}`}
              >
                <span aria-hidden className="text-sm">
                  {d.closed && !d.count ? "" : d.count}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "w-full rounded-lg",
                    d.iso === busiest?.iso && d.count ? "bg-white" : "bg-white/55",
                    d.closed && !d.count && "bg-white/25",
                  )}
                  style={{ height: `${Math.max(6, (d.count / max) * 100)}%` }}
                />
                <span aria-hidden className={cn("text-sm", d.iso === today && "font-bold")}>
                  {weekdayShort(d.iso).slice(0, 1)}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-[0.9375rem]">
            {s.closedDays.length
              ? `Closed ${s.closedDays.map(weekdayShort).join(", ")}`
              : "Open every day"}
            {busiest?.count ? ` · busiest ${weekdayShort(busiest.iso)} (${busiest.count})` : ""}
          </p>
        </section>

        <section aria-label="Waiting for pickup" className="rounded-[1.75rem] bg-card p-5 md:p-6">
          <h2 className="text-xl font-semibold">Waiting for pickup</h2>
          {s.waiting.length ? (
            <ul className="mt-2">
              {s.waiting.map((t) => (
                <li key={t.id} className="border-t border-border first:border-t-0">
                  <Link
                    to="/app/tickets/$ticketId"
                    params={{ ticketId: t.id }}
                    className="flex items-center justify-between gap-3 rounded-lg py-2.5"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{t.customer}</span>
                      <span className="truncate text-sm text-muted-foreground">
                        <span className="font-mono">#{t.number}</span> · {t.item}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-sm",
                        t.days > unclaimedDays
                          ? "font-medium text-warning"
                          : "text-muted-foreground",
                      )}
                    >
                      {t.days === 0
                        ? "Ready today"
                        : `Ready ${t.days} ${t.days === 1 ? "day" : "days"}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-muted-foreground">Nothing is waiting for pickup.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({
  label,
  icon,
  value,
  note,
  dark,
}: {
  label: string;
  icon: ReactNode;
  value: number;
  note: string;
  dark?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-[1.75rem] p-4 md:p-5",
        dark ? "surface-dark bg-background text-foreground" : "bg-card",
      )}
    >
      <span className="flex items-center justify-between gap-2 font-medium">
        {label}
        {icon}
      </span>
      <span className="text-4xl font-semibold tracking-tight md:text-5xl">{value}</span>
      <span className="text-sm text-muted-foreground">{note}</span>
    </div>
  );
}
