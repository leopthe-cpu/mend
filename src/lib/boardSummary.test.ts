import { describe, expect, it } from "vitest";

import { boardSummary } from "./boardSummary";
import { defaultSchedule } from "./hours";
import type { Status } from "./tickets";

const st = (id: string, position: number, extra: Partial<Status>): Status => ({
  id,
  name: id,
  position,
  category: "open",
  color: "received",
  idle_alert_days: null,
  due_alert_days: null,
  notify_by_default: false,
  is_final: false,
  ...extra,
});
const statuses = [
  st("rec", 1, {}),
  st("prog", 2, { color: "in-progress" }),
  st("ready", 3, { category: "ready", color: "ready" }),
  st("done", 4, { category: "closed", color: "closed", is_final: true }),
];
const now = new Date("2026-10-21T15:00:00Z"); // a Wednesday
const t = (n: number, status: string, promised: string | null, extra = {}) => ({
  id: `t${n}`,
  ticket_number: 1000 + n,
  item_name: `Item ${n}`,
  promised_date: promised,
  status_id: status,
  status_changed_at: "2026-10-20T15:00:00Z",
  assigned_to: null as string | null,
  customer: { name: `C${n}` },
  ...extra,
});

describe("boardSummary", () => {
  const s = boardSummary(
    [
      t(1, "rec", "2026-10-21"),
      t(2, "prog", "2026-10-21", { assigned_to: "u1" }),
      t(3, "prog", "2026-10-19", { assigned_to: "u2" }), // overdue
      t(4, "ready", "2026-10-18", { status_changed_at: "2026-10-12T15:00:00Z" }), // unclaimed, not overdue
      t(5, "ready", "2026-10-22"),
      t(6, "done", "2026-10-21"), // picked up: ignored
      t(7, "rec", "2026-10-25"), // Sunday
    ],
    statuses,
    "2026-10-21",
    7,
    defaultSchedule(),
    now,
  );

  it("counts open tickets only", () => {
    expect(s.dueToday).toBe(2);
    expect(s.notStartedToday).toBe(1);
    expect(s.inProgress).toBe(2);
    expect(s.people).toBe(2);
    expect(s.ready).toBe(2);
    expect(s.unclaimed).toBe(1);
    expect(s.overdue).toBe(1);
  });

  it("builds the week from Monday with closed days", () => {
    expect(s.week.map((d) => d.count)).toEqual([1, 0, 2, 1, 0, 0, 1]);
    expect(s.weekTotal).toBe(5);
    expect(s.closedDays).toEqual(["2026-10-24", "2026-10-25"]); // default: weekdays open
  });

  it("lists the longest-waiting pickups first", () => {
    expect(s.waiting.map((w) => w.number)).toEqual([1004, 1005]);
    expect(s.waiting[0]?.days).toBe(9);
  });
});
