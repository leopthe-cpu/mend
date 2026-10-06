import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, LayoutGrid } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { PageHeader } from "@/components/app/EmptyState";
import { selectClass } from "@/components/app/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyDbError } from "@/lib/shop";
import {
  fetchMembers,
  fetchStatuses,
  fetchTickets,
  isOverdue,
  shopToday,
  STATUS_COLOR_CLASS,
  type Member,
  type Status,
  type Ticket,
} from "@/lib/tickets";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/tickets/")({
  head: () => ({ meta: [{ title: "Tickets · Mend" }] }),
  component: TicketList,
});

type SortKey = "ticket_number" | "customer" | "item" | "status" | "promised_date" | "created_at";

function TicketList() {
  const { membership } = Route.useRouteContext();
  const shop = membership.shop;
  const navigate = useNavigate();
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("open");
  const [assignee, setAssignee] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({
    key: "ticket_number",
    asc: false,
  });

  useEffect(() => {
    // Remember that this person prefers the list (spec §7.3).
    try {
      localStorage.setItem("mend:ticketsView", "list");
    } catch {
      /* storage unavailable */
    }
    void Promise.all([fetchStatuses(shop.id), fetchTickets(shop.id), fetchMembers(shop.id)])
      .then(([s, t, m]) => {
        setStatuses(s);
        setTickets(t);
        setMembers(m);
      })
      .catch((e) => setError(friendlyDbError(e)));
  }, [shop.id]);

  const today = shopToday(shop.time_zone);
  const byStatus = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);
  const rows = useMemo(() => {
    const list = tickets.filter((t) => {
      const s = byStatus.get(t.status_id);
      if (statusFilter === "open" && s?.category === "closed") return false;
      if (statusFilter !== "open" && statusFilter !== "all" && t.status_id !== statusFilter)
        return false;
      if (assignee === "none" ? t.assigned_to : assignee && t.assigned_to !== assignee)
        return false;
      if (overdueOnly && !isOverdue(t, s, today)) return false;
      const created = t.created_at.slice(0, 10);
      if (from && created < from) return false;
      if (to && created > to) return false;
      return true;
    });
    const val = (t: Ticket): string | number => {
      switch (sort.key) {
        case "customer":
          return t.customer?.name.toLowerCase() ?? "";
        case "item":
          return t.item_name.toLowerCase();
        case "status":
          return byStatus.get(t.status_id)?.position ?? 0;
        case "promised_date":
          return t.promised_date ?? "9999";
        case "created_at":
          return t.created_at;
        default:
          return t.ticket_number;
      }
    };
    return list.sort(
      (a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * (sort.asc ? 1 : -1),
    );
  }, [tickets, byStatus, statusFilter, assignee, overdueOnly, from, to, sort, today]);

  const header = (key: SortKey, label: string) => (
    <th
      scope="col"
      className="px-3 py-2 font-medium"
      aria-sort={sort.key === key ? (sort.asc ? "ascending" : "descending") : "none"}
    >
      <button
        className="inline-flex min-h-11 items-center gap-1"
        onClick={() => setSort({ key, asc: sort.key === key ? !sort.asc : true })}
      >
        {label}
        {sort.key === key ? (
          sort.asc ? (
            <ArrowUp className="size-4" />
          ) : (
            <ArrowDown className="size-4" />
          )
        ) : null}
      </button>
    </th>
  );

  return (
    <>
      <PageHeader title="Tickets">
        <Button
          variant="outline"
          onClick={() => {
            try {
              localStorage.setItem("mend:ticketsView", "board");
            } catch {
              /* ignore */
            }
            void navigate({ to: "/app/board" });
          }}
        >
          <LayoutGrid /> Board view
        </Button>
      </PageHeader>
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <select
          aria-label="Status"
          className={selectClass}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="open">All open</option>
          <option value="all">All, including picked up</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Assigned to"
          className={selectClass}
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
        >
          <option value="">Anyone</option>
          <option value="none">Unassigned</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.name || m.email}
            </option>
          ))}
        </select>
        <Input
          aria-label="Created from"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Input
          aria-label="Created to"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            className="size-5"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
          />{" "}
          Overdue only
        </label>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-left">
          <thead className="border-b border-border text-sm text-muted-foreground">
            <tr>
              {header("ticket_number", "#")}
              {header("customer", "Customer")}
              {header("item", "Item")}
              {header("status", "Status")}
              {header("promised_date", "Promised")}
              {header("created_at", "Created")}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((t) => {
              const s = byStatus.get(t.status_id);
              const overdue = isOverdue(t, s, today);
              return (
                <tr key={t.id} className="hover:bg-accent/40">
                  <td className="px-3 py-3 font-mono">
                    <Link
                      to="/app/tickets/$ticketId"
                      params={{ ticketId: t.id }}
                      className="underline-offset-4 hover:underline"
                    >
                      #{t.ticket_number}
                    </Link>
                  </td>
                  <td className="px-3 py-3">{t.customer?.name}</td>
                  <td className="px-3 py-3">{t.item_name}</td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden
                        className={cn(
                          "size-2.5 rounded-full",
                          s ? STATUS_COLOR_CLASS[s.color] : "",
                        )}
                      />
                      {s?.name}
                    </span>
                  </td>
                  <td className={cn("px-3 py-3", overdue && "font-medium text-danger")}>
                    {t.promised_date ?? ""}
                    {overdue ? " · Overdue" : ""}
                  </td>
                  <td className="px-3 py-3 font-mono text-sm">{t.created_at.slice(0, 10)}</td>
                </tr>
              );
            })}
            {!rows.length ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-muted-foreground">
                  No tickets match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
