import { describe, expect, it } from "vitest";

import {
  ago,
  buildActivity,
  buildTodos,
  countdown,
  messageWhat,
  sendLockedUntil,
  type CentreEvent,
  type CentreMessage,
} from "@/lib/notifications";
import type { Member, Status, Ticket } from "@/lib/tickets";

const ready = { id: "ready", name: "Ready", category: "ready" } as Status;
const working = { id: "work", name: "In progress", category: "in_progress" } as unknown as Status;
const now = new Date("2026-10-23T15:00:00Z");
const ticket = (id: string, statusId: string, since: string, n = 1): Ticket =>
  ({
    id,
    ticket_number: n,
    status_id: statusId,
    status_changed_at: since,
    customer: { name: "Maria Lopez" },
  }) as unknown as Ticket;
const msg = (over: Partial<CentreMessage>): CentreMessage => ({
  ticket_id: "t1",
  channel: "sms",
  kind: "status",
  status: "sent",
  created_at: "2026-10-22T10:05:00Z",
  sent_by: "u1",
  ...over,
});
const members = [{ user_id: "u1", name: "Ana", role: "staff", email: "" }] as Member[];

describe("buildTodos", () => {
  const t1 = ticket("t1", "ready", "2026-10-22T10:00:00Z"); // Ready 29 h

  it("asks to tell the customer when nothing went out since Ready", () => {
    expect(buildTodos([t1], [ready], [], now).map((t) => t.kind)).toEqual(["tell"]);
  });

  it("flags a failed message", () => {
    const todos = buildTodos([t1], [ready], [msg({ status: "failed" })], now);
    expect(todos).toMatchObject([{ kind: "failed", channel: "sms" }]);
  });

  it("asks 'Was it picked up?' after 24 h in Ready once the customer was told", () => {
    expect(buildTodos([t1], [ready], [msg({})], now)).toMatchObject([
      { kind: "pickup", hours: 29 },
    ]);
  });

  it("doesn't ask before 24 h", () => {
    const fresh = ticket("t1", "ready", "2026-10-23T00:00:00Z");
    expect(
      buildTodos([fresh], [ready], [msg({ created_at: "2026-10-23T00:05:00Z" })], now),
    ).toEqual([]);
  });

  it("disappears for everyone once anyone sent a reminder (no double messages)", () => {
    const reminder = msg({ kind: "reminder", created_at: "2026-10-23T12:00:00Z", sent_by: "u2" });
    expect(buildTodos([t1], [ready], [msg({}), reminder], now)).toEqual([]);
    // A failed or canceled reminder doesn't count.
    for (const status of ["failed", "canceled"] as const)
      expect(buildTodos([t1], [ready], [msg({}), { ...reminder, status }], now)).toHaveLength(1);
  });

  it("ignores tickets that aren't Ready", () => {
    expect(
      buildTodos([ticket("t2", "work", "2026-10-01T00:00:00Z")], [ready, working], [], now),
    ).toEqual([]);
  });

  it("lists the longest wait first", () => {
    const older = ticket("t0", "ready", "2026-10-20T10:00:00Z");
    const todos = buildTodos([t1, older], [ready], [], now);
    expect(todos.map((t) => t.ticket.id)).toEqual(["t0", "t1"]);
  });
});

describe("buildActivity", () => {
  const tickets = [ticket("t1", "ready", "2026-10-22T10:00:00Z", 1043)];
  const ev = (over: Partial<CentreEvent>): CentreEvent => ({
    ticket_id: "t1",
    type: "status_change",
    actor_id: "u1",
    data: { to: "Ready", to_category: "ready" },
    created_at: "2026-10-22T10:00:00Z",
    ...over,
  });

  it("says who did what, newest first", () => {
    const items = buildActivity(
      [ev({}), ev({ type: "created", data: {}, created_at: "2026-10-21T09:00:00Z" })],
      [msg({ kind: "reminder", created_at: "2026-10-23T12:00:00Z" })],
      tickets,
      members,
    );
    expect(items.map((i) => i.text)).toEqual([
      "Ana sent a reminder to Maria Lopez (#1043)",
      "Ana moved #1043 (Maria Lopez) to Ready",
      "Ana logged #1043 (Maria Lopez)",
    ]);
  });

  it("reads picked up as a closing step and automatic messages as Mend's", () => {
    const items = buildActivity(
      [ev({ data: { to: "Picked up", to_category: "closed" } })],
      [
        msg({ sent_by: null, channel: "email" }),
        msg({ status: "failed", created_at: "2026-10-22T11:00:00Z" }),
      ],
      tickets,
      members,
    );
    expect(items.map((i) => i.text)).toEqual([
      "Ana's text to Maria Lopez (#1043) failed",
      "Mend sent an email to Maria Lopez (#1043)",
      "Ana marked #1043 (Maria Lopez) picked up",
    ]);
  });

  it("lists messages waiting to send, but not canceled ones", () => {
    const items = buildActivity(
      [],
      [
        msg({ status: "queued", kind: "reminder", channel: "email" }),
        msg({ status: "sending" }),
        msg({ status: "canceled" }),
      ],
      tickets,
      members,
    );
    expect(items.map((i) => i.text)).toEqual([
      "Ana's reminder to Maria Lopez (#1043) is waiting to send",
      "Ana's text to Maria Lopez (#1043) is waiting to send",
    ]);
  });
});

describe("ago", () => {
  it("reads like a person would say it", () => {
    expect(ago("2026-10-23T14:59:40Z", now)).toBe("just now");
    expect(ago("2026-10-23T14:55:00Z", now)).toBe("5 min ago");
    expect(ago("2026-10-23T12:00:00Z", now)).toBe("3 h ago");
    expect(ago("2026-10-22T14:00:00Z", now)).toBe("1 day ago");
    expect(ago("2026-10-20T15:00:00Z", now)).toBe("3 days ago");
  });
});

describe("two minutes between messages", () => {
  it("locks Send until the last message is 2 minutes old", () => {
    expect(sendLockedUntil("2026-10-23T14:59:00Z", now)).toBe(
      new Date("2026-10-23T15:01:00Z").getTime(),
    );
    expect(sendLockedUntil("2026-10-23T14:58:00Z", now)).toBeNull();
    expect(sendLockedUntil(null, now)).toBeNull();
  });
  it("counts down in minutes and seconds", () => {
    expect(countdown(84_000)).toBe("1:24");
    expect(countdown(500)).toBe("0:01");
  });
  it("names the automatic message", () => {
    expect(messageWhat("created", "sms")).toBe("the automatic “ticket created” text");
    expect(messageWhat("status", "email")).toBe("an email");
  });
  it("shows the automatic message as Mend's in Activity", () => {
    const tickets = [ticket("t1", "ready", "2026-10-22T10:00:00Z", 1043)];
    const items = buildActivity([], [msg({ kind: "created" })], tickets, members);
    expect(items[0]?.text).toBe("Mend sent a text to Maria Lopez (#1043)");
  });
});
