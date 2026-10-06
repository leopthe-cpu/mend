import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Mail, MessageSquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { selectClass } from "@/components/app/Field";
import { FormAlert } from "@/components/auth/AuthLayout";
import { type Message, type MessageStatus, shopTime, STATUS_TEXT } from "@/lib/messages";
import { friendlyDbError } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/messages")({
  head: () => ({ meta: [{ title: "Messages · Mend" }] }),
  component: MessagesPage,
});

type Row = Message & {
  ticket: { ticket_number: number; item_name: string } | null;
  customer: { name: string } | null;
};

/** Start of the current calendar month in the shop's time zone, as an ISO instant. */
function monthStartIso(timeZone: string): string {
  const now = new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      timeZoneName: "longOffset",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  // e.g. "GMT-04:00" -> "-04:00"; "GMT" alone means UTC.
  const offset = (parts["timeZoneName"] ?? "GMT").replace("GMT", "") || "+00:00";
  return new Date(`${parts["year"]}-${parts["month"]}-01T00:00:00${offset}`).toISOString();
}

function MessagesPage() {
  const { membership } = Route.useRouteContext();
  const shop = membership.shop;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState<"all" | MessageStatus>("all");
  const [error, setError] = useState<string | null>(null);
  const [smsThisMonth, setSmsThisMonth] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const db = getSupabase();
      let q = db
        .from("messages")
        .select("*, ticket:tickets(ticket_number, item_name), customer:customers(name)")
        .eq("shop_id", shop.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (filter !== "all") q = q.eq("status", filter);
      const [list, usage] = await Promise.all([
        q,
        db
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("shop_id", shop.id)
          .eq("channel", "sms")
          .neq("status", "canceled")
          .gte("created_at", monthStartIso(shop.time_zone)),
      ]);
      if (list.error) throw list.error;
      setRows((list.data ?? []) as unknown as Row[]);
      setSmsThisMonth(usage.count ?? 0);
    } catch (e) {
      setError(friendlyDbError(e));
    }
  }, [shop.id, shop.time_zone, filter]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader title="Messages" />
      <div className="flex max-w-4xl flex-col gap-4">
        {error ? <FormAlert tone="error">{error}</FormAlert> : null}
        <div className="flex flex-wrap items-center gap-4">
          <select
            aria-label="Show"
            className={cn(selectClass, "w-auto")}
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
          >
            <option value="all">All messages</option>
            <option value="failed">Failed</option>
            <option value="queued">Waiting to send</option>
            <option value="delivered">Delivered</option>
          </select>
          {smsThisMonth !== null ? (
            <p className="text-muted-foreground">
              Texts this month: {smsThisMonth} of {shop.sms_monthly_cap}
            </p>
          ) : null}
        </div>

        {rows === null ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState eyebrow="Nothing yet" title="No messages">
            When a ticket moves to a status that notifies (like Ready), Mend asks before texting or
            emailing the customer. Every message shows up here with its delivery status.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {rows.map((m) => {
              const Icon = m.channel === "sms" ? MessageSquare : Mail;
              const failed = m.status === "failed";
              return (
                <li key={m.id} className="flex flex-col gap-1 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon className="size-4 text-muted-foreground" aria-hidden />
                    <span className="font-medium">{m.customer?.name}</span>
                    {m.ticket ? (
                      <Link
                        to="/app/tickets/$ticketId"
                        params={{ ticketId: m.ticket_id }}
                        className="text-muted-foreground underline-offset-4 hover:underline"
                      >
                        #{m.ticket.ticket_number} · {m.ticket.item_name}
                      </Link>
                    ) : null}
                    <span
                      className={cn(
                        "ml-auto text-sm font-medium",
                        failed ? "text-danger" : "text-muted-foreground",
                      )}
                    >
                      {failed ? <AlertTriangle className="mr-1 inline size-4" aria-hidden /> : null}
                      {m.status === "queued" && m.queued_for_quiet_hours
                        ? `Quiet hours: sends ${shopTime(m.scheduled_for, shop.time_zone)}`
                        : STATUS_TEXT[m.status]}{" "}
                      · {shopTime(m.created_at, shop.time_zone)}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-muted-foreground">
                    {m.subject ? `${m.subject}: ` : ""}
                    {m.body}
                  </p>
                  {failed && m.error ? <p className="text-sm text-danger">{m.error}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
