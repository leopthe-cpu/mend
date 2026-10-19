import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, LayoutGrid, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { DateRangePicker, type DateRangeValue } from "@/components/app/DateRangePicker";
import { PageHeader } from "@/components/app/EmptyState";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { friendlyDbError } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
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

type SortKey =
  | "ticket_number"
  | "customer"
  | "item"
  | "total"
  | "status"
  | "promised_date"
  | "created_at"
  | "assigned_to"
  | "created_by";

function Chip({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface-2 px-3 text-sm">
      {children}
      <button
        type="button"
        aria-label="Remove filter"
        onClick={onClear}
        className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </span>
  );
}

function TicketList() {
  const { membership } = Route.useRouteContext();
  const shop = membership.shop;
  const navigate = useNavigate();
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  // Current (non-superseded) estimate total per ticket, for the Total column.
  const [totals, setTotals] = useState<Map<string, number>>(new Map());
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const [creatorFilter, setCreatorFilter] = useState<string | null>(null);
  const [range, setRange] = useState<DateRangeValue>({ from: "", to: "" });
  const [overdue, setOverdue] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
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
    void Promise.all([
      fetchStatuses(shop.id),
      fetchTickets(shop.id),
      fetchMembers(shop.id),
      getSupabase()
        .from("estimates")
        .select("ticket_id, total_cents")
        .eq("shop_id", shop.id)
        .neq("status", "superseded"),
    ])
      .then(([s, t, m, e]) => {
        setStatuses(s);
        setTickets(t);
        setMembers(m);
        setTotals(
          new Map(
            ((e.data ?? []) as { ticket_id: string; total_cents: number }[]).map((x) => [
              x.ticket_id,
              Number(x.total_cents),
            ]),
          ),
        );
      })
      .catch((e) => setError(friendlyDbError(e)));
  }, [shop.id]);

  const today = shopToday(shop.time_zone);
  const byStatus = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);

  const memberName = (id: string | null) => {
    const m = members.find((x) => x.user_id === id);
    return m ? m.name || m.email : "—";
  };

  const rows = useMemo(() => {
    const list = tickets.filter((t) => {
      const s = byStatus.get(t.status_id);
      if (statusFilter && t.status_id !== statusFilter) return false;
      if (assigneeFilter) {
        if (assigneeFilter === "none" ? t.assigned_to : t.assigned_to !== assigneeFilter)
          return false;
      }
      if (creatorFilter && t.created_by !== creatorFilter) return false;
      if (overdue && !isOverdue(t, s, today)) return false;
      if (s?.category === "closed" && !(showClosed || t.status_id === statusFilter)) return false;
      // Compare in the shop's time zone (not UTC).
      const created = shopToday(shop.time_zone, new Date(t.created_at));
      if (range.from && created < range.from) return false;
      if (range.to && created > range.to) return false;
      return true;
    });
    const val = (t: Ticket): string | number => {
      switch (sort.key) {
        case "customer":
          return t.customer?.name.toLowerCase() ?? "";
        case "item":
          return t.item_name.toLowerCase();
        case "total":
          return totals.get(t.id) ?? -1;
        case "status":
          return byStatus.get(t.status_id)?.position ?? 0;
        case "promised_date":
          return t.promised_date ?? "9999";
        case "created_at":
          return t.created_at;
        case "assigned_to":
          return memberName(t.assigned_to).toLowerCase();
        case "created_by":
          return memberName(t.created_by).toLowerCase();
        default:
          return t.ticket_number;
      }
    };
    return list.sort(
      (a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * (sort.asc ? 1 : -1),
    );
  }, [
    tickets,
    totals,
    byStatus,
    statusFilter,
    assigneeFilter,
    creatorFilter,
    overdue,
    showClosed,
    range,
    sort,
    today,
    shop.time_zone,
    members,
  ]);

  const openTicket = (id: string) =>
    void navigate({ to: "/app/tickets/$ticketId", params: { ticketId: id } });

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

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <DateRangePicker value={range} onChange={setRange} />
        <button
          type="button"
          onClick={() => setOverdue(!overdue)}
          className={cn(
            "min-h-11 rounded-md border px-3 text-sm font-medium",
            overdue ? "border-primary bg-surface-2 text-foreground" : "border-input",
          )}
        >
          Overdue only
        </button>
        <button
          type="button"
          onClick={() => setShowClosed(!showClosed)}
          className={cn(
            "min-h-11 rounded-md border px-3 text-sm font-medium",
            showClosed ? "border-primary bg-surface-2 text-foreground" : "border-input",
          )}
        >
          Include picked up
        </button>
        {statusFilter ? (
          <Chip onClear={() => setStatusFilter(null)}>
            {statuses.find((s) => s.id === statusFilter)?.name}
          </Chip>
        ) : null}
        {assigneeFilter ? (
          <Chip onClear={() => setAssigneeFilter(null)}>
            {assigneeFilter === "none" ? "Unassigned" : memberName(assigneeFilter)}
          </Chip>
        ) : null}
        {creatorFilter ? (
          <Chip onClear={() => setCreatorFilter(null)}>Created by {memberName(creatorFilter)}</Chip>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-lg bg-card">
        <table className="w-full text-left">
          <thead className="border-b border-border text-sm text-muted-foreground">
            <tr>
              {header("ticket_number", "#")}
              {header("customer", "Customer")}
              {header("item", "Item")}
              {header("total", "Total")}
              {header("status", "Status")}
              {header("assigned_to", "Assigned to")}
              {header("promised_date", "Promised")}
              {header("created_at", "Created")}
              {header("created_by", "Created by")}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((t) => {
              const s = byStatus.get(t.status_id);
              const overdueRow = isOverdue(t, s, today);
              return (
                <tr
                  key={t.id}
                  role="link"
                  tabIndex={0}
                  className="cursor-pointer hover:bg-accent/40"
                  onClick={() => openTicket(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openTicket(t.id);
                    }
                  }}
                >
                  <td className="px-3 py-3 font-mono">#{t.ticket_number}</td>
                  <td className="px-3 py-3">{t.customer?.name}</td>
                  <td className="px-3 py-3">{t.item_name}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {totals.has(t.id) ? formatMoney(totals.get(t.id) ?? 0, shop.currency) : "—"}
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center gap-2 rounded-md underline-offset-4 hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        setStatusFilter(statusFilter === t.status_id ? null : t.status_id);
                      }}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "size-2.5 rounded-full",
                          s ? STATUS_COLOR_CLASS[s.color] : "",
                        )}
                      />
                      {s?.name}
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      className="min-h-11 rounded-md underline-offset-4 hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = t.assigned_to ?? "none";
                        setAssigneeFilter(assigneeFilter === next ? null : next);
                      }}
                    >
                      {memberName(t.assigned_to)}
                    </button>
                  </td>
                  <td className={cn("px-3 py-3", overdueRow && "font-medium text-danger")}>
                    {t.promised_date ?? ""}
                    {overdueRow ? " · Overdue" : ""}
                  </td>
                  <td className="px-3 py-3 font-mono text-sm">
                    {shopToday(shop.time_zone, new Date(t.created_at))}
                  </td>
                  <td className="px-3 py-3">
                    {t.created_by ? (
                      <button
                        type="button"
                        className="min-h-11 rounded-md underline-offset-4 hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCreatorFilter(creatorFilter === t.created_by ? null : t.created_by);
                        }}
                      >
                        {memberName(t.created_by)}
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
            {!rows.length ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-muted-foreground">
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
