import { describe, expect, it } from "vitest";

import { memberName, readyContact, type ContactMessage } from "@/lib/tickets";

const ticket = { id: "t1", status_changed_at: "2026-10-22T15:00:00Z" };
const msg = (over: Partial<ContactMessage>): ContactMessage => ({
  ticket_id: "t1",
  channel: "sms",
  status: "sent",
  created_at: "2026-10-22T15:01:00Z",
  ...over,
});

describe("readyContact: was the customer told the item is ready?", () => {
  it("is 'none' with no message since the ticket became Ready", () => {
    expect(readyContact(ticket, [])).toEqual({ state: "none" });
    // Before it became Ready, another ticket's, or canceled: none of them count.
    expect(
      readyContact(ticket, [
        msg({ created_at: "2026-10-22T14:59:00Z" }),
        msg({ ticket_id: "t2" }),
        msg({ status: "canceled" }),
      ]),
    ).toEqual({ state: "none" });
  });

  it("reports a sent or delivered message, with its channel", () => {
    expect(readyContact(ticket, [msg({ status: "delivered", channel: "email" })])).toEqual({
      state: "sent",
      channel: "email",
      at: "2026-10-22T15:01:00Z",
    });
  });

  it("prefers sent over waiting over failed, whatever the order", () => {
    const failed = msg({ status: "failed", created_at: "2026-10-22T16:00:00Z" });
    const queued = msg({ status: "queued", created_at: "2026-10-22T15:30:00Z" });
    const sent = msg({ status: "sent", created_at: "2026-10-22T15:10:00Z" });
    expect(readyContact(ticket, [failed, queued, sent]).state).toBe("sent");
    expect(readyContact(ticket, [failed, queued]).state).toBe("pending");
    expect(readyContact(ticket, [failed]).state).toBe("failed");
  });

  it("uses the latest message of the winning kind", () => {
    const r = readyContact(ticket, [
      msg({ channel: "sms", created_at: "2026-10-22T15:10:00Z" }),
      msg({ channel: "email", created_at: "2026-10-23T09:00:00Z" }),
    ]);
    expect(r).toEqual({ state: "sent", channel: "email", at: "2026-10-23T09:00:00Z" });
  });
});

describe("memberName", () => {
  it("uses the name, else the part of the email before the @", () => {
    expect(memberName({ name: "Ana Lopez", email: "ana@shop.ca" })).toBe("Ana Lopez");
    expect(memberName({ name: "  ", email: "ana.lopez@shop.ca" })).toBe("ana.lopez");
    expect(memberName({ name: "", email: "" })).toBe("A team member");
  });
});

describe("readyContact follows the log (decision 138)", () => {
  it("keeps 'told' when the ticket left Ready and came back", () => {
    const t = { id: "t1", status_changed_at: "2026-10-24T22:36:59Z", status_id: "ready" };
    const sentBefore = {
      ticket_id: "t1",
      channel: "sms" as const,
      status: "delivered" as const,
      created_at: "2026-10-24T22:36:40Z",
      kind: "status",
      status_id: "ready",
    };
    expect(readyContact(t, [sentBefore]).state).toBe("sent");
    expect(readyContact(t, [{ ...sentBefore, status_id: "in_progress" }]).state).toBe("none");
  });
});
