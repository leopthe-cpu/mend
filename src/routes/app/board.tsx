import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Bell, Image as ImageIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { PageHeader } from "@/components/app/EmptyState";
import { StatusMenu } from "@/components/tickets/StatusMenu";
import { friendlyDbError } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import {
  fetchMembers,
  fetchStatuses,
  fetchTickets,
  initials,
  isOverdue,
  isUnclaimed,
  onBoard,
  shopToday,
  signedPhotoUrls,
  STATUS_COLOR_CLASS,
  type Member,
  type Status,
  type Ticket,
} from "@/lib/tickets";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/board")({
  head: () => ({ meta: [{ title: "Board · Mend" }] }),
  component: Board,
});

function Board() {
  const { membership } = Route.useRouteContext();
  const shop = membership.shop;
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, t, m] = await Promise.all([
        fetchStatuses(shop.id),
        fetchTickets(shop.id),
        fetchMembers(shop.id),
      ]);
      setStatuses(s);
      setTickets(t);
      setMembers(m);
      const ids = t.map((x) => x.id);
      if (ids.length) {
        const { data } = await getSupabase()
          .from("ticket_photos")
          .select("ticket_id, storage_path, created_at")
          .in("ticket_id", ids.slice(0, 300))
          .order("created_at");
        const first = new Map<string, string>();
        for (const p of data ?? [])
          if (!first.has(p.ticket_id as string))
            first.set(p.ticket_id as string, p.storage_path as string);
        const urls = await signedPhotoUrls([...first.values()]);
        setThumbs(new Map([...first].map(([tid, path]) => [tid, urls.get(path) ?? ""])));
      }
    } catch (e) {
      setError(friendlyDbError(e));
    } finally {
      setLoaded(true);
    }
  }, [shop.id]);
  useEffect(() => {
    try {
      localStorage.setItem("mend:ticketsView", "board");
    } catch {
      /* storage unavailable */
    }
    void load();
  }, [load]);

  async function move(ticketId: string, statusId: string) {
    const prev = tickets;
    setTickets(
      tickets.map((t) =>
        t.id === ticketId
          ? { ...t, status_id: statusId, status_changed_at: new Date().toISOString() }
          : t,
      ),
    );
    const { error } = await getSupabase().rpc("set_ticket_status", {
      p_ticket_id: ticketId,
      p_status_id: statusId,
    });
    if (error) {
      setTickets(prev);
      setError(friendlyDbError(error));
    }
  }

  const today = shopToday(shop.time_zone);
  const memberName = (id: string | null) => {
    const m = members.find((x) => x.user_id === id);
    return m ? m.name || m.email : "";
  };

  return (
    <>
      <PageHeader title="Board" />
      {error ? (
        <div className="mb-4">
          <FormAlert tone="error">{error}</FormAlert>
        </div>
      ) : null}
      {loaded && !tickets.length ? (
        <p className="mb-4 text-muted-foreground">
          No tickets yet. Press{" "}
          <kbd className="rounded border border-border px-1.5 font-mono">N</kbd> or click{" "}
          <strong>New ticket</strong> to log your first job.
        </p>
      ) : null}
      <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8">
        {statuses.map((s) => {
          const col = tickets.filter((t) => t.status_id === s.id && onBoard(t, s));
          return (
            <section
              key={s.id}
              aria-label={`${s.name}, ${col.length} tickets`}
              className={cn(
                "flex w-72 shrink-0 snap-start flex-col rounded-lg border border-border bg-card",
                dragOver === s.id && "ring-2 ring-ring",
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(s.id);
              }}
              onDragLeave={() => setDragOver((d) => (d === s.id ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const id = e.dataTransfer.getData("text/ticket-id");
                if (id) void move(id, s.id);
              }}
            >
              <h2 className="flex items-center gap-2 border-b border-border px-4 py-3 font-semibold">
                <span
                  aria-hidden
                  className={cn("size-2.5 rounded-full", STATUS_COLOR_CLASS[s.color])}
                />
                {s.name}
                <span className="ml-auto font-mono text-sm text-muted-foreground">
                  {col.length}
                </span>
              </h2>
              <ol className="flex flex-col gap-3 p-3">
                {col.map((t) => {
                  const overdue = isOverdue(t, s, today);
                  const unclaimed = isUnclaimed(t, s, shop.unclaimed_reminder_days);
                  const assignee = memberName(t.assigned_to);
                  return (
                    <li
                      key={t.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/ticket-id", t.id)}
                      className="rounded-md border border-border bg-surface-2 p-3"
                    >
                      <div className="flex gap-3">
                        {thumbs.get(t.id) ? (
                          <img
                            src={thumbs.get(t.id)}
                            alt=""
                            className="size-14 shrink-0 rounded object-cover"
                            loading="lazy"
                          />
                        ) : null}
                        <Link
                          to="/app/tickets/$ticketId"
                          params={{ ticketId: t.id }}
                          className="min-w-0 flex-1 rounded"
                        >
                          <div className="font-mono text-sm text-muted-foreground">
                            #{t.ticket_number}
                          </div>
                          <div className="truncate font-semibold">{t.customer?.name}</div>
                          <div className="truncate">{t.item_name}</div>
                        </Link>
                        {assignee ? (
                          <span
                            title={assignee}
                            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-sm"
                          >
                            {initials(assignee)}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                        {t.promised_date ? (
                          <span className="text-muted-foreground">Due {t.promised_date}</span>
                        ) : null}
                        {!thumbs.get(t.id) ? null : (
                          <ImageIcon
                            className="size-4 text-muted-foreground"
                            aria-label="Has photos"
                          />
                        )}
                        {overdue ? (
                          <span className="inline-flex items-center gap-1 rounded border border-status-overdue px-1.5 font-medium text-danger">
                            <AlertTriangle className="size-3.5" aria-hidden /> Overdue
                          </span>
                        ) : null}
                        {unclaimed ? (
                          <span className="inline-flex items-center gap-1 rounded border border-status-waiting px-1.5 font-medium text-warning">
                            <Bell className="size-3.5" aria-hidden /> Unclaimed
                          </span>
                        ) : null}
                      </div>
                      <StatusMenu
                        className="mt-2 h-10"
                        statuses={statuses}
                        value={t.status_id}
                        onChange={(id) => void move(t.id, id)}
                        label={`Move #${t.ticket_number} to`}
                      />
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>
      {statuses.length ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Drag a card or use its menu to move it. Picked-up tickets leave the board after 7 days;
          they stay in{" "}
          <Link to="/app/tickets" className="underline">
            Tickets
          </Link>
          .
        </p>
      ) : null}
    </>
  );
}
