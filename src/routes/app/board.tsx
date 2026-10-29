import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { StopAlerts } from "@/components/messages/StopAlerts";
import { FormAlert } from "@/components/auth/AuthLayout";
import { promptHeldMessages } from "@/components/messages/messageToasts";
import { NotifyDialog, type NotifyRequest } from "@/components/messages/NotifyDialog";
import { BoardCard } from "@/components/board/BoardCard";
import { ColumnDialog, type ColumnRequest } from "@/components/board/ColumnDialog";
import { ColumnHeader } from "@/components/board/ColumnHeader";
import { usePointerDrag } from "@/components/board/usePointerDrag";
import { TicketsTop } from "@/components/tickets/TicketsTop";
import { friendlyDbError, roleAtLeast } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import {
  fetchStatuses,
  fetchTicket,
  fetchTickets,
  boardColumn,
  isDueSoon,
  isIdle,
  isOverdue,
  messagePlane,
  shopToday,
  STATUS_COLOR_CLASS,
  type ContactMessage,
  type Status,
  type Ticket,
} from "@/lib/tickets";
import { cn } from "@/lib/utils";

/**
 * Height that takes the board from where it starts down to the bottom of the
 * window, keeping the page's bottom padding in
 * view (19 Oct round 3; decision 116). Each column then scrolls on its own
 * instead of the whole page. Re-measured whenever anything above changes
 * size (summary hidden or shown, a banner appears) or the window resizes.
 * Computers only: on phones the page scrolls as before, under the tab bar.
 */
function useFillHeight(board: React.RefObject<HTMLElement | null>): number | undefined {
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const wide = window.matchMedia("(min-width: 768px)");
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = board.current;
        if (!el || !wide.matches) return setHeight(undefined);
        const top = el.getBoundingClientRect().top + window.scrollY;
        const rest = 32; // main's pb-8
        const h = Math.max(384, Math.round(window.innerHeight - top - rest));
        // Only a real change sets state, so the board's own resize settles.
        setHeight((old) => (old !== undefined && Math.abs(old - h) < 2 ? old : h));
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    // The page's own container, not <body>: the app shell keeps <body> at
    // least a window tall, so it doesn't resize when the summary is hidden.
    const page = board.current?.parentElement;
    if (page) ro.observe(page);
    window.addEventListener("resize", measure);
    wide.addEventListener("change", measure);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("resize", measure);
      wide.removeEventListener("change", measure);
    };
  }, [board]);
  return height;
}

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

/** The tickets the board shows: every open one, the latest picked-up ones. */
function onBoardIds(tickets: Ticket[], statuses: Status[]): string[] {
  return statuses.flatMap((s) => boardColumn(tickets, s).shown.map((t) => t.id));
}

function Board() {
  const { membership } = Route.useRouteContext();
  const { created, ticket: createdId, photoProblems } = Route.useSearch();
  const shop = membership.shop;
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [photoCounts, setPhotoCounts] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notify, setNotify] = useState<NotifyRequest | null>(null);
  const [contacts, setContacts] = useState<ContactMessage[]>([]);

  // Messages for the tickets on the board, for each card's message icon
  // (decision 142). Read-only; RLS limits them to this shop.
  const loadContacts = useCallback(async (ids: string[]) => {
    if (!ids.length) return setContacts([]);
    const { data, error } = await getSupabase()
      .from("messages")
      .select("ticket_id, channel, status, created_at, kind, status_id")
      .in("ticket_id", ids.slice(0, 300))
      .neq("status", "canceled");
    if (!error) setContacts((data ?? []) as ContactMessage[]);
  }, []);

  const load = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([fetchStatuses(shop.id), fetchTickets(shop.id)]);
      setStatuses(s);
      setTickets(t);
      const ids = onBoardIds(t, s);
      void loadContacts(ids);
      if (ids.length) {
        const { data } = await getSupabase()
          .from("ticket_photos")
          .select("ticket_id")
          .in("ticket_id", ids.slice(0, 300));
        const counts = new Map<string, number>();
        for (const p of data ?? [])
          counts.set(p.ticket_id as string, (counts.get(p.ticket_id as string) ?? 0) + 1);
        setPhotoCounts(counts);
      }
    } catch (e) {
      setError(friendlyDbError(e));
    } finally {
      setLoaded(true);
    }
  }, [shop.id, loadContacts]);
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
    // The server's "moved here" time, not this computer's clock: the card's
    // message icon compares it with message times.
    const fresh = await fetchTicket(ticketId);
    if (fresh) setTickets((ts) => ts.map((t) => (t.id === ticketId ? fresh : t)));
    const moved = prev.find((t) => t.id === ticketId);
    const status = statuses.find((s) => s.id === statusId);
    // Messages that hadn't gone out are held; ask whether to still send them.
    if (moved)
      void promptHeldMessages({
        ticketId,
        ticketNumber: moved.ticket_number,
        statusName: status?.name ?? "a new status",
        who: moved.customer?.name.split(" ")[0] || "the customer",
      });
    // Statuses that notify by default ask first; nothing is sent automatically.
    if (status?.notify_by_default) {
      setNotify({ ticketId, kind: "status", statusId });
    }
  }

  const boardRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Header and cards scroll sideways together.
  const follow = (from: HTMLElement | null, to: HTMLElement | null) => {
    if (from && to && to.scrollLeft !== from.scrollLeft) to.scrollLeft = from.scrollLeft;
  };
  const boardHeight = useFillHeight(boardRef);

  // Columns are edited on the board by Owner and Admin (decision 145).
  const canEditColumns = roleAtLeast(membership.role, "admin");
  const [column, setColumn] = useState<ColumnRequest | null>(null);
  const counts = new Map(statuses.map((s) => [s.id, boardColumn(tickets, s).total]));
  // A column header being dragged: where the pointer is and where it would land
  // (an index between columns, 0 = before the first).
  const [colDrag, setColDrag] = useState<{ id: string; x: number; y: number; over: number } | null>(
    null,
  );
  const colDragId = colDrag?.id;
  useEffect(() => {
    if (!colDragId) return;
    const landing = (x: number) => {
      const cells = Array.from(headRef.current?.children ?? []);
      return cells.filter((c) => {
        const r = c.getBoundingClientRect();
        return r.left + r.width / 2 < x;
      }).length;
    };
    const onMove = (e: PointerEvent) =>
      setColDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY, over: landing(e.clientX) } : d));
    const onUp = (e: PointerEvent) => {
      const over = landing(e.clientX);
      setColDrag(null);
      const from = statuses.findIndex((x) => x.id === colDragId);
      if (from < 0 || over === from || over === from + 1) return;
      const ids = statuses.map((x) => x.id).filter((id) => id !== colDragId);
      ids.splice(over > from ? over - 1 : over, 0, colDragId);
      void reorder(ids);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // statuses is read at drop time; re-binding mid-drag isn't needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colDragId]);

  async function reorder(ids: string[]) {
    const prev = statuses;
    setStatuses(ids.map((id, i) => ({ ...prev.find((x) => x.id === id)!, position: i })));
    const { error } = await getSupabase().rpc("reorder_statuses", {
      p_shop_id: shop.id,
      p_ids: ids,
    });
    if (error) {
      setStatuses(prev);
      setError(friendlyDbError(error));
    }
  }
  const dropAt = (i: number) => {
    if (!colDrag) return { before: false, after: false };
    const from = statuses.findIndex((x) => x.id === colDrag.id);
    const lands = colDrag.over !== from && colDrag.over !== from + 1;
    return {
      before: lands && colDrag.over === i,
      after: lands && i === statuses.length - 1 && colDrag.over === statuses.length,
    };
  };

  const today = shopToday(shop.time_zone);
  const { drag, cardProps } = usePointerDrag((id, statusId) => {
    if (tickets.find((t) => t.id === id)?.status_id !== statusId) void move(id, statusId);
  });
  const dragged = drag ? tickets.find((t) => t.id === drag.id) : undefined;
  const dragStatus = dragged ? statuses.find((s) => s.id === dragged.status_id) : undefined;

  return (
    <>
      <TicketsTop
        current="/app/board"
        membership={membership}
        tickets={loaded ? tickets : undefined}
        statuses={loaded ? statuses : undefined}
        selfLoad={false}
      />
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
      <NotifyDialog
        request={notify}
        membership={membership}
        onClose={(sent) => {
          setNotify(null);
          // A message was queued: refresh the message icons.
          if (sent) void loadContacts(onBoardIds(tickets, statuses));
        }}
      />
      {loaded && !tickets.length ? (
        <p className="mb-4 text-muted-foreground">
          No tickets yet. Press{" "}
          <kbd className="rounded border border-border px-1.5 font-mono">N</kbd> or click{" "}
          <strong>New ticket</strong> to log your first job.
        </p>
      ) : null}
      {/* One board, columns joined edge to edge (decision 140, after Oz's
          reference): a header strip with every column's name and count, its
          scroll bar right under it, and the cards below. Header and body
          scroll sideways together; only the header shows a scroll bar. Each
          column takes an equal share of the width, at least 17rem. */}
      <div
        ref={boardRef}
        style={boardHeight ? { height: boardHeight } : undefined}
        className="flex flex-col overflow-hidden rounded-lg border border-border bg-card"
      >
        <div
          ref={headRef}
          onScroll={() => follow(headRef.current, bodyRef.current)}
          className="board-scroll flex shrink-0 overflow-x-auto border-b border-border"
        >
          {statuses.map((s, i) => {
            const { shown: col, total } = boardColumn(tickets, s);
            const drop = dropAt(i);
            return (
              <ColumnHeader
                key={s.id}
                status={s}
                total={total}
                late={col.filter((t) => isOverdue(t, s, today)).length}
                soon={col.filter((t) => isDueSoon(t, s, today)).length}
                idle={col.filter((t) => isIdle(t, s)).length}
                canEdit={canEditColumns}
                last={i === statuses.length - 1}
                dropBefore={drop.before}
                dropAfter={drop.after}
                dragging={colDrag?.id === s.id}
                dragActive={!!colDrag}
                onOpen={() => setColumn({ kind: "edit", status: s })}
                onAdd={() => setColumn({ kind: "new", after: s })}
                onDragStart={(e) => setColDrag({ id: s.id, x: e.clientX, y: e.clientY, over: i })}
              />
            );
          })}
        </div>
        <div
          ref={bodyRef}
          onScroll={() => follow(bodyRef.current, headRef.current)}
          className="flex min-h-0 flex-1 overflow-x-auto bg-background [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {statuses.map((s, i) => {
            const { shown: col, total } = boardColumn(tickets, s);
            const drop = dropAt(i);
            return (
              <section
                key={s.id}
                data-drop-id={s.id}
                aria-label={`${s.name}, ${total} tickets`}
                className={cn(
                  "flex min-w-[17rem] flex-1 basis-0 flex-col border-r border-border last:border-r-0",
                  drag?.over === s.id && "bg-accent/60",
                  colDrag?.id === s.id && "opacity-40",
                  drop.before && "shadow-[inset_4px_0_0_var(--color-primary)]",
                  drop.after && "shadow-[inset_-4px_0_0_var(--color-primary)]",
                )}
              >
                <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
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
                        photos={photoCounts.get(t.id) ?? 0}
                        plane={messagePlane(t, s, contacts)}
                        timeZone={shop.time_zone}
                        finished={s.is_final}
                        onRemind={() => setNotify({ ticketId: t.id, kind: "reminder" })}
                        onCompose={() =>
                          setNotify(
                            s.notify_by_default
                              ? { ticketId: t.id, kind: "status", statusId: s.id }
                              : { ticketId: t.id, kind: "manual" },
                          )
                        }
                      />
                    </li>
                  ))}
                  {total > col.length ? (
                    <li>
                      <Link
                        to="/app/tickets"
                        search={{ f: `status:${s.id}` }}
                        className="flex min-h-11 items-center justify-center rounded-lg text-sm font-medium text-primary hover:bg-card"
                      >
                        See all {total} in the list
                      </Link>
                    </li>
                  ) : null}
                </ol>
              </section>
            );
          })}
        </div>
      </div>
      <ColumnDialog
        request={column}
        shopId={shop.id}
        statuses={statuses}
        counts={counts}
        onClose={() => setColumn(null)}
        onSaved={() => void load()}
        onMove={(id, dir) => {
          const ids = statuses.map((x) => x.id);
          const i = ids.indexOf(id);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= ids.length) return;
          [ids[i], ids[j]] = [ids[j]!, ids[i]!];
          void reorder(ids);
        }}
      />
      {/* The column header under the pointer while it's dragged (only the
          header moves; its tickets follow when it lands). */}
      {colDrag ? (
        <div
          aria-hidden
          className="pointer-events-none fixed top-0 left-0 z-50 flex w-64 rotate-2 items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 font-semibold shadow-[0_12px_32px_rgba(0,0,0,0.18)]"
          style={{ transform: `translate(${colDrag.x - 40}px, ${colDrag.y - 24}px) rotate(2deg)` }}
        >
          <span
            className={cn(
              "size-2.5 shrink-0 rounded-full",
              STATUS_COLOR_CLASS[statuses.find((x) => x.id === colDrag.id)?.color ?? "received"],
            )}
          />
          {statuses.find((x) => x.id === colDrag.id)?.name}
        </div>
      ) : null}
      {/* The card under the pointer while dragging. */}
      {drag && dragged && dragStatus ? (
        <div
          aria-hidden
          className="pointer-events-none fixed top-0 left-0 z-50 rotate-2 cursor-grabbing rounded-lg shadow-[0_12px_32px_rgba(0,0,0,0.18)]"
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
            photos={photoCounts.get(dragged.id) ?? 0}
            plane={messagePlane(dragged, dragStatus, contacts)}
            timeZone={shop.time_zone}
          />
        </div>
      ) : null}
    </>
  );
}
