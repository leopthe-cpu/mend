import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Bell, Image as ImageIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { StopAlerts } from "@/components/messages/StopAlerts";
import { FormAlert } from "@/components/auth/AuthLayout";
import { PageHeader } from "@/components/app/EmptyState";
import { NotifyDialog, type NotifyRequest } from "@/components/messages/NotifyDialog";
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

type BoardSearch = { created?: number; ticket?: string; photoProblems?: number };

export const Route = createFileRoute("/app/board")({
  head: () => ({ meta: [{ title: "Board · Mend" }] }),
  // Set by the new-ticket dialog, which comes back here with a confirmation.
  validateSearch: (s: Record<string, unknown>): BoardSearch => ({
    ...(Number(s["created"]) > 0 ? { created: Number(s["created"]) } : {}),
    ...(typeof s["ticket"] === "string" ? { ticket: s["ticket"] } : {}),
    ...(Number(s["photoProblems"]) > 0 ? { photoProblems: Number(s["photoProblems"]) } : {}),
  }),
  component: Board,
});

function Board() {
  const { membership } = Route.useRouteContext();
  const { created, ticket: createdId, photoProblems } = Route.useSearch();
  const shop = membership.shop;
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notify, setNotify] = useState<NotifyRequest | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
    // createdId: a ticket was just created (possibly while already on the
    // board), so load again to show it.
  }, [load, createdId]);

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
      return;
    }
    // Statuses that notify by default ask first; nothing is sent automatically.
    if (statuses.find((s) => s.id === statusId)?.notify_by_default) {
      setNotify({ ticketId, kind: "status", statusId });
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
      <StopAlerts shopId={shop.id} timeZone={shop.time_zone} />
      {error ? (
        <div className="mb-4">
          <FormAlert tone="error">{error}</FormAlert>
        </div>
      ) : null}
      {created && createdId ? (
        <div className="mb-4">
          <FormAlert tone="info">
            Ticket #{created} created
            {photoProblems ? ", but some photos couldn't be uploaded" : ""}.{" "}
            <Link
              to="/app/tickets/$ticketId"
              params={{ ticketId: createdId }}
              className="font-medium underline"
            >
              Open it
            </Link>{" "}
            ·{" "}
            <Link
              to="/tag/$ticketId"
              params={{ ticketId: createdId }}
              target="_blank"
              className="font-medium underline"
            >
              Print the claim tag
            </Link>
          </FormAlert>
        </div>
      ) : null}
      {notice ? (
        <div className="mb-4">
          <FormAlert tone="info">{notice}</FormAlert>
        </div>
      ) : null}
      <NotifyDialog
        request={notify}
        membership={membership}
        onClose={(result) => {
          setNotify(null);
          if (result) setNotice(result);
        }}
      />
      {loaded && !tickets.length ? (
        <p className="mb-4 text-muted-foreground">
          No tickets yet. Press{" "}
          <kbd className="rounded border border-border px-1.5 font-mono">N</kbd> or click{" "}
          <strong>+ Ticket</strong> to log your first job.
        </p>
      ) : null}
      {/* Columns scroll sideways inside the board only. The scroll padding keeps
          the first column lined up with the page title: without it, snapping
          pulls the first column flush to the edge (Oz's feedback, UX plan v2). */}
      <div className="-mx-4 flex snap-x scroll-px-4 gap-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:scroll-px-8 md:px-8">
        {statuses.map((s) => {
          const col = tickets.filter((t) => t.status_id === s.id && onBoard(t, s));
          return (
            <section
              key={s.id}
              aria-label={`${s.name}, ${col.length} tickets`}
              className={cn(
                "flex w-[17rem] shrink-0 snap-start flex-col rounded-[1.75rem] bg-card sm:w-72",
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
                          <button
                            type="button"
                            className="inline-flex min-h-8 items-center gap-1 rounded border border-status-waiting px-1.5 font-medium text-warning hover:bg-status-waiting/10"
                            onClick={() => setNotify({ ticketId: t.id, kind: "reminder" })}
                            aria-label={`Unclaimed: send #${t.ticket_number} a pickup reminder`}
                          >
                            <Bell className="size-3.5" aria-hidden /> Unclaimed · Send reminder
                          </button>
                        ) : null}
                      </div>
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
          Drag a card to another column to move it, or open the ticket to change its status.
          Picked-up tickets leave the board after 7 days; they stay in{" "}
          <Link to="/app/tickets" className="underline">
            Tickets
          </Link>
          .
        </p>
      ) : null}
    </>
  );
}
