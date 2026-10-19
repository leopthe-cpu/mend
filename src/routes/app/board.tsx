import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { StopAlerts } from "@/components/messages/StopAlerts";
import { FormAlert } from "@/components/auth/AuthLayout";
import { NotifyDialog, type NotifyRequest } from "@/components/messages/NotifyDialog";
import { BoardCard } from "@/components/board/BoardCard";
import { BoardSummary } from "@/components/board/BoardSummary";
import { usePointerDrag } from "@/components/board/usePointerDrag";
import { TicketViewSwitch } from "@/components/tickets/TicketViewSwitch";
import { friendlyDbError } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import {
  fetchMembers,
  fetchStatuses,
  fetchTickets,
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
  const { drag, cardProps } = usePointerDrag((id, statusId) => {
    if (tickets.find((t) => t.id === id)?.status_id !== statusId) void move(id, statusId);
  });
  const dragged = drag ? tickets.find((t) => t.id === drag.id) : undefined;
  const dragStatus = dragged ? statuses.find((s) => s.id === dragged.status_id) : undefined;
  const memberName = (id: string | null) => {
    const m = members.find((x) => x.user_id === id);
    return m ? m.name || m.email : "";
  };

  return (
    <>
      <h1 className="mb-5 text-[1.75rem] leading-tight font-semibold md:text-[2.125rem]">
        {greeting(shop.time_zone)}, <span className="text-muted-foreground">{shop.name}</span>
      </h1>
      {loaded && tickets.length ? (
        <BoardSummary
          tickets={tickets}
          statuses={statuses}
          today={today}
          unclaimedDays={shop.unclaimed_reminder_days}
          schedule={shop.business_hours?.schedule}
        />
      ) : null}
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
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-xl font-semibold">Tickets</h2>
        <TicketViewSwitch current="/app/board" />
      </div>
      {/* Columns scroll sideways inside the board only. The scroll padding keeps
          the first column lined up with the page title: without it, snapping
          pulls the first column flush to the edge (Oz's feedback, UX plan v2). */}
      <div className="flex snap-x gap-4 overflow-x-auto pb-4">
        {statuses.map((s) => {
          const col = tickets.filter((t) => t.status_id === s.id && onBoard(t, s));
          return (
            <section
              key={s.id}
              data-drop-id={s.id}
              aria-label={`${s.name}, ${col.length} tickets`}
              className={cn(
                "flex w-[17rem] shrink-0 snap-start flex-col rounded-[1.75rem] bg-card sm:w-72",
                drag?.over === s.id && "ring-2 ring-ring",
              )}
            >
              <h2 className="flex items-center gap-2 px-5 pt-4 pb-1 font-semibold">
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
                {col.map((t) => (
                  <li
                    key={t.id}
                    {...cardProps(t.id)}
                    className={cn(
                      "cursor-grab transition-opacity",
                      drag?.id === t.id && "opacity-30",
                    )}
                  >
                    <BoardCard
                      ticket={t}
                      status={s}
                      today={today}
                      unclaimedDays={shop.unclaimed_reminder_days}
                      thumb={thumbs.get(t.id)}
                      assignee={memberName(t.assigned_to)}
                      onRemind={() => setNotify({ ticketId: t.id, kind: "reminder" })}
                    />
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
      {/* The card under the pointer while dragging. */}
      {drag && dragged && dragStatus ? (
        <div
          aria-hidden
          className="pointer-events-none fixed top-0 left-0 z-50 rotate-2 cursor-grabbing shadow-[0_12px_32px_rgba(0,0,0,0.18)] rounded-2xl"
          style={{
            width: drag.width,
            transform: `translate(${drag.x - drag.dx}px, ${drag.y - drag.dy}px) rotate(2deg)`,
          }}
        >
          <BoardCard
            ticket={dragged}
            status={dragStatus}
            today={today}
            unclaimedDays={shop.unclaimed_reminder_days}
            thumb={thumbs.get(dragged.id)}
            assignee={memberName(dragged.assigned_to)}
          />
        </div>
      ) : null}
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

/** "Good morning" before noon, "Good afternoon" until 6pm, then "Good evening", in the shop's time zone. */
function greeting(timeZone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-CA", { timeZone, hour: "numeric", hourCycle: "h23" }).format(
      new Date(),
    ),
  );
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}
