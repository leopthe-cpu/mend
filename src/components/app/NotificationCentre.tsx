import { Link } from "@tanstack/react-router";
import { Bell, MessageSquareWarning, PackageCheck, Store } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { promptHeldMessages } from "@/components/messages/messageToasts";
import { NotifyDialog, type NotifyRequest } from "@/components/messages/NotifyDialog";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  ago,
  buildActivity,
  buildTodos,
  type ActivityItem,
  type CentreEvent,
  type CentreMessage,
  type Todo,
} from "@/lib/notifications";
import { friendlyDbError, roleAtLeast, shopAttention, type Membership } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import { fetchMembers, fetchStatuses, fetchTickets, type Status, type Ticket } from "@/lib/tickets";
import { cn } from "@/lib/utils";

// Decision 134. The bell in the top bar: to-dos (counted in the red badge)
// and the team's activity (listed, never counted). Everything comes from the
// shop's own data, so a to-do someone else finished disappears for everyone.

const MESSAGE_COLUMNS = "ticket_id, channel, kind, status, status_id, created_at, sent_by";
const REFRESH_MS = 120_000;

type Data = {
  statuses: Status[];
  tickets: Ticket[];
  todos: Todo[];
  activity: ActivityItem[];
};

async function loadCentre(shopId: string): Promise<Data> {
  const sb = getSupabase();
  const [statuses, tickets, members] = await Promise.all([
    fetchStatuses(shopId),
    fetchTickets(shopId),
    fetchMembers(shopId),
  ]);
  const readyStatus = new Set(statuses.filter((s) => s.category === "ready").map((s) => s.id));
  const readyIds = tickets.filter((t) => readyStatus.has(t.status_id)).map((t) => t.id);
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [ready, recent, events] = await Promise.all([
    // Every message of the Ready tickets, however old: told or not.
    readyIds.length
      ? sb.from("messages").select(MESSAGE_COLUMNS).in("ticket_id", readyIds.slice(0, 300))
      : null,
    // The last 7 days, for Activity.
    sb
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("shop_id", shopId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(300),
    sb
      .from("ticket_events")
      .select("ticket_id, type, actor_id, data, created_at")
      .eq("shop_id", shopId)
      .in("type", ["created", "status_change"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);
  for (const r of [ready, recent, events]) if (r?.error) throw r.error;
  const readyMessages = (ready?.data ?? []) as CentreMessage[];
  const recentMessages = (recent.data ?? []) as CentreMessage[];
  return {
    statuses,
    tickets,
    todos: buildTodos(tickets, statuses, readyMessages),
    activity: buildActivity((events.data ?? []) as CentreEvent[], recentMessages, tickets, members),
  };
}

export function NotificationCentre({ membership }: { membership: Membership }) {
  const shop = membership.shop;
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [notify, setNotify] = useState<NotifyRequest | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await loadCentre(shop.id));
    } catch (e) {
      setNotice({ tone: "error", text: friendlyDbError(e) });
    }
  }, [shop.id]);

  // On load, every 2 minutes, when the window comes back into focus and when
  // the panel opens: what someone else did shows up without a reload.
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);
  useEffect(() => {
    if (open) {
      setNotice(null);
      void load();
    }
  }, [open, load]);

  const missing = roleAtLeast(membership.role, "admin") ? shopAttention(shop) : [];
  const todos = data?.todos ?? [];
  const count = todos.length + (missing.length ? 1 : 0);

  // No double messages (Oz, 23 Oct): look again right before opening the
  // message dialog; if someone already took care of it, say who instead.
  async function act(todo: Todo, request: NotifyRequest) {
    setBusy(todo.ticket.id);
    try {
      const fresh = await loadCentre(shop.id);
      setData(fresh);
      const still = fresh.todos.some((t) => t.ticket.id === todo.ticket.id && t.kind === todo.kind);
      if (!still) {
        const done = fresh.activity.find((a) => a.ticketId === todo.ticket.id);
        setNotice({
          tone: "info",
          text: `Already taken care of${done ? `: ${done.text}, ${ago(done.at)}` : ""}.`,
        });
        return;
      }
      setOpen(false);
      setNotify(request);
    } catch (e) {
      setNotice({ tone: "error", text: friendlyDbError(e) });
    } finally {
      setBusy(null);
    }
  }

  async function markPickedUp(todo: Todo) {
    const final = [...(data?.statuses ?? [])]
      .filter((s) => s.is_final)
      .sort((a, b) => a.position - b.position)[0];
    if (!final) return setNotice({ tone: "error", text: "This shop has no picked-up status." });
    if (
      todo.ticket.has_passcode &&
      !window.confirm("Mark as picked up? The saved device passcode will be deleted.")
    )
      return;
    setBusy(todo.ticket.id);
    const { error } = await getSupabase().rpc("set_ticket_status", {
      p_ticket_id: todo.ticket.id,
      p_status_id: final.id,
    });
    setBusy(null);
    if (error) return setNotice({ tone: "error", text: friendlyDbError(error) });
    setNotice({
      tone: "info",
      text: `#${todo.ticket.ticket_number} marked ${final.name.toLowerCase()}.`,
    });
    void promptHeldMessages({
      ticketId: todo.ticket.id,
      ticketNumber: todo.ticket.ticket_number,
      statusName: final.name,
      who: todo.ticket.customer?.name.split(" ")[0] || "the customer",
    });
    void load();
  }

  const label = count ? `Notifications, ${count} to do` : "Notifications";
  const trigger = (
    <button
      type="button"
      aria-label={label}
      onClick={isMobile ? () => setOpen(true) : undefined}
      className="relative flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-card text-foreground transition-colors hover:bg-border/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Bell aria-hidden className="size-5" />
      {count ? (
        <span
          aria-hidden
          className="absolute -top-1 -right-1 flex min-w-5 items-center justify-center rounded-full bg-danger px-1 text-xs font-semibold text-primary-foreground tabular-nums ring-2 ring-background"
        >
          {count > 9 ? "9+" : count}
        </span>
      ) : null}
    </button>
  );

  const panel = (
    <div className="flex max-h-[70svh] flex-col gap-4 overflow-y-auto p-4">
      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn(
            "rounded-lg border px-3 py-2 text-sm",
            notice.tone === "error"
              ? "border-danger/60 bg-danger/10 text-danger"
              : "border-border bg-card text-foreground",
          )}
        >
          {notice.text}
        </p>
      ) : null}
      <section aria-labelledby="nc-todo">
        <h3 id="nc-todo" className="mb-2 font-semibold">
          To do
        </h3>
        {!data ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : count === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing needs you right now.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {missing.length ? (
              <Item
                icon={<Store className="size-4" aria-hidden />}
                title="Finish your shop profile"
                detail={`Missing: ${missing.join(", ")}.`}
              >
                <Button asChild size="sm" variant="outline" className="min-h-11">
                  <Link
                    to="/app/settings/shop"
                    hash={missing[0] ?? ""}
                    onClick={() => setOpen(false)}
                  >
                    Open Settings
                  </Link>
                </Button>
              </Item>
            ) : null}
            {todos.map((t) => (
              <TodoItem
                key={`${t.kind}-${t.ticket.id}`}
                todo={t}
                busy={busy === t.ticket.id}
                onTell={() =>
                  void act(t, { ticketId: t.ticket.id, kind: "status", statusId: t.status.id })
                }
                onRemind={() => void act(t, { ticketId: t.ticket.id, kind: "reminder" })}
                onPickedUp={() => void markPickedUp(t)}
                onOpen={() => setOpen(false)}
              />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="nc-activity">
        <h3 id="nc-activity" className="mb-2 font-semibold">
          Activity <span className="font-normal text-muted-foreground">· last 7 days</span>
        </h3>
        {data && !data.activity.length ? (
          <p className="text-sm text-muted-foreground">Nothing in the last 7 days.</p>
        ) : (
          <ul className="flex flex-col">
            {(data?.activity ?? []).map((a, i) => (
              <li
                key={`${a.at}-${i}`}
                className="border-b border-border py-2 text-sm last:border-0"
              >
                {a.ticketId ? (
                  <Link
                    to="/app/tickets/$ticketId"
                    params={{ ticketId: a.ticketId }}
                    onClick={() => setOpen(false)}
                    className="hover:underline"
                  >
                    {a.text}
                  </Link>
                ) : (
                  a.text
                )}
                <span className="block text-muted-foreground">{ago(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );

  return (
    <>
      {isMobile ? (
        <>
          {trigger}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetContent side="bottom" className="rounded-t-[1.75rem] p-0">
              <SheetHeader className="px-4 pt-4">
                <SheetTitle>Notifications</SheetTitle>
                <SheetDescription className="sr-only">To-dos and recent activity</SheetDescription>
              </SheetHeader>
              {panel}
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="w-[26rem] rounded-[1.75rem] border-0 p-0 shadow-[0_4px_24px_rgba(0,0,0,0.12)]"
          >
            <h2 className="px-4 pt-4 text-lg font-semibold">Notifications</h2>
            {panel}
          </PopoverContent>
        </Popover>
      )}
      <NotifyDialog
        request={notify}
        membership={membership}
        onClose={() => {
          setNotify(null);
          void load();
        }}
      />
    </>
  );
}

function Item({
  icon,
  title,
  detail,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  detail: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex gap-2">
        <span className="mt-0.5 text-muted-foreground">{icon}</span>
        <div className="min-w-0">
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{detail}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </li>
  );
}

function TodoItem({
  todo: t,
  busy,
  onTell,
  onRemind,
  onPickedUp,
  onOpen,
}: {
  todo: Todo;
  busy: boolean;
  onTell: () => void;
  onRemind: () => void;
  onPickedUp: () => void;
  onOpen: () => void;
}) {
  const who = t.ticket.customer?.name ?? "the customer";
  const ref = (
    <Link
      to="/app/tickets/$ticketId"
      params={{ ticketId: t.ticket.id }}
      onClick={onOpen}
      className="font-mono underline-offset-4 hover:underline"
    >
      #{t.ticket.ticket_number}
    </Link>
  );
  const since = ago(t.ticket.status_changed_at);
  const readySince = since === "just now" ? "Just ready" : `Ready for ${since.replace(" ago", "")}`;
  if (t.kind === "pickup")
    return (
      <Item
        icon={<PackageCheck className="size-4" aria-hidden />}
        title={<>Was {ref} picked up?</>}
        detail={`${who} · ${t.ticket.item_name} · Ready for ${t.hours} h`}
      >
        <Button
          size="sm"
          variant="outline"
          className="min-h-11"
          disabled={busy}
          onClick={onPickedUp}
        >
          Picked up
        </Button>
        <Button size="sm" className="min-h-11" disabled={busy} onClick={onRemind}>
          Send reminder
        </Button>
      </Item>
    );
  const failed = t.kind === "failed";
  return (
    <Item
      icon={
        <MessageSquareWarning
          className={cn("size-4", failed ? "text-danger" : "text-warning")}
          aria-hidden
        />
      }
      title={
        failed ? (
          <>
            {t.channel === "sms" ? "Text" : "Email"} to {who} ({ref}) failed
          </>
        ) : (
          <>
            {who} doesn't know {ref} is ready
          </>
        )
      }
      detail={`${t.ticket.item_name} · ${readySince}`}
    >
      <Button size="sm" className="min-h-11" disabled={busy} onClick={onTell}>
        {failed ? "Try again" : "Tell them"}
      </Button>
    </Item>
  );
}
