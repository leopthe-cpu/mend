import { weekDays } from "./calendar";
import { isOpenOn, type WeeklySchedule } from "./hours";
import { isOverdue, isUnclaimed, type Status, type Ticket } from "./tickets";

// The numbers at the top of the Board (decision 94). Pure, so it is tested
// without a database. "Open" = not in a final status (picked up).

type T = Pick<
  Ticket,
  | "id"
  | "ticket_number"
  | "item_name"
  | "promised_date"
  | "status_id"
  | "status_changed_at"
  | "assigned_to"
> & { customer?: { name: string } | null };

export function boardSummary(
  tickets: T[],
  statuses: Status[],
  today: string,
  unclaimedDays: number,
  schedule: WeeklySchedule | undefined,
  now = new Date(),
) {
  const byId = new Map(statuses.map((s) => [s.id, s]));
  const firstStatus = [...statuses].sort((a, b) => a.position - b.position)[0];
  const open = tickets.filter((t) => byId.get(t.status_id) && !byId.get(t.status_id)?.is_final);

  const dueToday = open.filter((t) => t.promised_date === today);
  const inProgress = open.filter((t) => byId.get(t.status_id)?.color === "in-progress");
  const ready = open
    .filter((t) => byId.get(t.status_id)?.category === "ready")
    .sort((a, b) => a.status_changed_at.localeCompare(b.status_changed_at));

  const week = weekDays(today).map((iso) => ({
    iso,
    closed: !isOpenOn(schedule, iso),
    count: open.filter((t) => t.promised_date === iso).length,
  }));

  return {
    dueToday: dueToday.length,
    notStartedToday: dueToday.filter((t) => t.status_id === firstStatus?.id).length,
    inProgress: inProgress.length,
    people: new Set(inProgress.map((t) => t.assigned_to).filter(Boolean)).size,
    ready: ready.length,
    unclaimed: ready.filter((t) => isUnclaimed(t, byId.get(t.status_id), unclaimedDays, now))
      .length,
    overdue: open.filter((t) => isOverdue(t, byId.get(t.status_id), today)).length,
    week,
    weekTotal: week.reduce((n, d) => n + d.count, 0),
    closedDays: week.filter((d) => d.closed).map((d) => d.iso),
    waiting: ready.slice(0, 5).map((t) => ({
      id: t.id,
      number: t.ticket_number,
      customer: t.customer?.name ?? "",
      item: t.item_name,
      days: Math.max(
        0,
        Math.floor((now.getTime() - new Date(t.status_changed_at).getTime()) / 86_400_000),
      ),
    })),
  };
}
