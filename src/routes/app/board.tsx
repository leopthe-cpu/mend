import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { StopAlerts } from "@/components/messages/StopAlerts";
import { FormAlert } from "@/components/auth/AuthLayout";
import { promptHeldMessages } from "@/components/messages/messageToasts";
import { NotifyDialog, type NotifyRequest } from "@/components/messages/NotifyDialog";
import { BoardCard } from "@/components/board/BoardCard";
import { usePointerDrag } from "@/components/board/usePointerDrag";
import { TicketsTop } from "@/components/tickets/TicketsTop";
import { openNewTicket } from "@/lib/newTicket";
import { friendlyDbError } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import {
  fetchMembers,
  fetchStatuses,
  fetchTicket,
  fetchTickets,
  isOverdue,
  onBoard,
  memberName as nameOf,
  readyContact,
  shopToday,
  signedPhotoUrls,
  STATUS_COLOR_CLASS,
  type ContactMessage,
  type Member,
  type Status,
  type Ticket,
} from "@/lib/tickets";
import { cn } from "@/lib/utils";

/**
 * Height that takes the board from where it starts down to the bottom of the
 * window, keeping `below` (the hint under it) and the page's bottom padding in
 * view (19 Oct round 3; decision 116). Each column then scrolls on its own
 * instead of the whole page. Re-measured whenever anything above changes
 * size (summary hidden or shown, a banner appears) or the window resizes.
 * Computers only: on phones the page scrolls as before, under the tab bar.
 */
function useFillHeight(
  board: React.RefObject<HTMLElement | null>,
  below: React.RefObject<HTMLElement | null>,
): number | undefined {
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
        const rest = (below.current?.offsetHeight ?? 0) + 8 + 32; // hint margin + main's pb-8
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
  }, [board, below]);
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
  const [contacts, setContacts] = useState<ContactMessage[]>([]);

  // Messages for Ready tickets, so each card can say whether the customer was
  // told it's ready (Oz, 23 Oct). Read-only; RLS limits them to this shop.
  const loadContacts = useCallback(async (readyIds: string[]) => {
    if (!readyIds.length) return setContacts([]);
    const { data, error } = await getSupabase()
      .from("messages")
      .select("ticket_id, channel, status, created_at, kind, status_id")
      .in("ticket_id", readyIds.slice(0, 300))
      .neq("status", "canceled");
    if (!error) setContacts((data ?? []) as ContactMessage[]);
  }, []);

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
      const ready = new Set(s.filter((x) => x.category === "ready").map((x) => x.id));
      void loadContacts(t.filter((x) => ready.has(x.status_id)).map((x) => x.id));
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
    // The server's "Ready since" time, not this computer's clock: the card's
    // told / not told tag compares it with message times.
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
  const hintRef = useRef<HTMLParagraphElement>(null);
  const boardHeight = useFillHeight(boardRef, hintRef);

  const today = shopToday(shop.time_zone);
  const { drag, cardProps } = usePointerDrag((id, statusId) => {
    if (tickets.find((t) => t.id === id)?.status_id !== statusId) void move(id, statusId);
  });
  const dragged = drag ? tickets.find((t) => t.id === drag.id) : undefined;
  const dragStatus = dragged ? statuses.find((s) => s.id === dragged.status_id) : undefined;
  const memberName = (id: string | null) => {
    const m = members.find((x) => x.user_id === id);
    return m ? nameOf(m) : "";
  };

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
          if (sent) {
            // A message was queued: refresh the "told / not told" tags.
            const ready = new Set(statuses.filter((x) => x.category === "ready").map((x) => x.id));
            void loadContacts(tickets.filter((x) => ready.has(x.status_id)).map((x) => x.id));
          }
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
            const col = tickets.filter((t) => t.status_id === s.id && onBoard(t, s));
            const late = s.is_final ? 0 : col.filter((t) => isOverdue(t, s, today)).length;
            return (
              <div
                key={s.id}
                className="min-w-[17rem] flex-1 basis-0 border-r border-border px-4 py-2.5 last:border-r-0"
              >
                <h2 className="flex items-center gap-2 font-semibold">
                  {/* The title opens the List with only this status (decision
                      117), including picked-up tickets older than the board's
                      7 days. */}
                  <Link
                    to="/app/tickets"
                    search={{ f: `status:${s.id}` }}
                    title={`See all ${s.name} tickets in the list`}
                    className="-mx-2 flex min-w-0 items-center gap-2 rounded-full px-2 py-0.5 hover:bg-background"
                  >
                    <span
                      aria-hidden
                      className={cn("size-2.5 shrink-0 rounded-full", STATUS_COLOR_CLASS[s.color])}
                    />
                    <span className="truncate">{s.name}</span>
                  </Link>
                  <span className="ml-auto font-mono text-sm text-muted-foreground">
                    {col.length}
                  </span>
                  {/* New tickets start in the first column, so it gets the
                      same + as the top bar (decision 115). */}
                  {i === 0 ? (
                    <button
                      type="button"
                      onClick={openNewTicket}
                      aria-label="New ticket"
                      title="New ticket"
                      className="-my-1 -mr-2 flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
                    >
                      <Plus aria-hidden className="size-4" />
                    </button>
                  ) : null}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {s.is_final
                    ? "Last 7 days"
                    : late
                      ? `${late} overdue`
                      : col.length
                        ? "None overdue"
                        : "Empty"}
                </p>
              </div>
            );
          })}
        </div>
        <div
          ref={bodyRef}
          onScroll={() => follow(bodyRef.current, headRef.current)}
          className="flex min-h-0 flex-1 overflow-x-auto bg-background [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {statuses.map((s) => {
            const col = tickets.filter((t) => t.status_id === s.id && onBoard(t, s));
            return (
              <section
                key={s.id}
                data-drop-id={s.id}
                aria-label={`${s.name}, ${col.length} tickets`}
                className={cn(
                  "flex min-w-[17rem] flex-1 basis-0 flex-col border-r border-border last:border-r-0",
                  drag?.over === s.id && "bg-accent/60",
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
                        thumb={thumbs.get(t.id)}
                        assignee={memberName(t.assigned_to)}
                        contact={readyContact(t, contacts)}
                        timeZone={shop.time_zone}
                        onRemind={() => setNotify({ ticketId: t.id, kind: "reminder" })}
                        onTell={() => setNotify({ ticketId: t.id, kind: "status", statusId: s.id })}
                      />
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}
        </div>
      </div>
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
            thumb={thumbs.get(dragged.id)}
            assignee={memberName(dragged.assigned_to)}
            contact={readyContact(dragged, contacts)}
            timeZone={shop.time_zone}
          />
        </div>
      ) : null}
      {statuses.length ? (
        <p ref={hintRef} className="mt-2 text-sm text-muted-foreground">
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
