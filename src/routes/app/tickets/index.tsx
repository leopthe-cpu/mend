import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { DateRangePicker, type DateRangeValue } from "@/components/app/DateRangePicker";
import { FilterBar, ValueChip, type FilterOption } from "@/components/app/FilterBar";
import { PageHeader } from "@/components/app/EmptyState";
import { TicketViewSwitch } from "@/components/tickets/TicketViewSwitch";
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
  STATUS_TINT_CLASS,
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
  // Filters as ids ("status:<id>", "assigned:<id|none>", "created:<id>",
  // "customer:<id>", "flag:overdue", "flag:closed"); see FilterBar.
  const [active, setActive] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [range, setRange] = useState<DateRangeValue>({ from: "", to: "" });
  const toggle = (id: string) =>
    setActive((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  const isOn = (id: string) => active.includes(id);
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

  const options = useMemo<FilterOption[]>(() => {
    const people = members.map((m) => ({ id: m.user_id, name: m.name || m.email }));
    const customers = new Map(tickets.map((t) => [t.customer_id, t.customer?.name ?? ""]));
    return [
      { id: "flag:overdue", group: "Show", label: "Overdue only" },
      { id: "flag:closed", group: "Show", label: "Include picked up" },
      ...statuses.map((st) => ({
        id: `status:${st.id}`,
        group: "Status",
        label: st.name,
        dotClass: STATUS_COLOR_CLASS[st.color],
      })),
      ...people.map((m) => ({ id: `assigned:${m.id}`, group: "Assigned to", label: m.name })),
      { id: "assigned:none", group: "Assigned to", label: "Unassigned" },
      ...people.map((m) => ({ id: `created:${m.id}`, group: "Created by", label: m.name })),
      ...[...customers]
        .sort(([, a], [, b]) => a.localeCompare(b))
        .map(([id, name]) => ({ id: `customer:${id}`, group: "Customer", label: name })),
    ];
  }, [statuses, members, tickets]);

  const rows = useMemo(() => {
    const pick = (prefix: string) =>
      new Set(active.filter((a) => a.startsWith(prefix)).map((a) => a.slice(prefix.length)));
    const fStatus = pick("status:");
    const fAssigned = pick("assigned:");
    const fCreated = pick("created:");
    const fCustomer = pick("customer:");
    const q = text.trim().toLowerCase().replace(/^#/, "");
    const list = tickets.filter((t) => {
      const s = byStatus.get(t.status_id);
      if (fStatus.size && !fStatus.has(t.status_id)) return false;
      if (fAssigned.size && !fAssigned.has(t.assigned_to ?? "none")) return false;
      if (fCreated.size && !fCreated.has(t.created_by ?? "")) return false;
      if (fCustomer.size && !fCustomer.has(t.customer_id)) return false;
      if (active.includes("flag:overdue") && !isOverdue(t, s, today)) return false;
      if (s?.category === "closed" && !(active.includes("flag:closed") || fStatus.has(t.status_id)))
        return false;
      if (
        q &&
        !String(t.ticket_number).startsWith(q) &&
        !(t.customer?.name ?? "").toLowerCase().includes(q) &&
        !t.item_name.toLowerCase().includes(q)
      )
        return false;
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
  }, [tickets, totals, byStatus, active, text, range, sort, today, shop.time_zone, members]);

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
        <TicketViewSwitch current="/app/tickets" />
      </PageHeader>
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}

      <FilterBar
        options={options}
        active={active}
        onToggle={toggle}
        text={text}
        onText={setText}
        placeholder="Search or filter: customer, item, #, status, person…"
      >
        <DateRangePicker value={range} onChange={setRange} />
      </FilterBar>

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
                  <td className="px-3 py-3">
                    {/* Customer: plain text that filters, no chip (item 12). */}
                    <button
                      type="button"
                      aria-pressed={isOn(`customer:${t.customer_id}`)}
                      className={cn(
                        "min-h-11 cursor-pointer text-left underline-offset-4 hover:underline",
                        isOn(`customer:${t.customer_id}`) && "font-semibold underline",
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(`customer:${t.customer_id}`);
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      {t.customer?.name}
                    </button>
                  </td>
                  <td className="px-3 py-3">{t.item_name}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {totals.has(t.id) ? formatMoney(totals.get(t.id) ?? 0, shop.currency) : "—"}
                  </td>
                  <td className="px-3 py-3">
                    {s ? (
                      <ValueChip
                        label={s.name}
                        dotClass={STATUS_COLOR_CLASS[s.color]}
                        tintClass={STATUS_TINT_CLASS[s.color]}
                        pressed={isOn(`status:${s.id}`)}
                        onClick={() => toggle(`status:${s.id}`)}
                      />
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <ValueChip
                      label={t.assigned_to ? memberName(t.assigned_to) : "Unassigned"}
                      pressed={isOn(`assigned:${t.assigned_to ?? "none"}`)}
                      onClick={() => toggle(`assigned:${t.assigned_to ?? "none"}`)}
                    />
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
                      <ValueChip
                        label={memberName(t.created_by)}
                        pressed={isOn(`created:${t.created_by}`)}
                        onClick={() => toggle(`created:${t.created_by}`)}
                      />
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
