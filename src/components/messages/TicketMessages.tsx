import { AlertTriangle, Mail, MessageSquare, Send, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Panel } from "@/components/app/Field";
import { Button } from "@/components/ui/button";
import { fetchTicketMessages, type Message, shopTime, STATUS_TEXT } from "@/lib/messages";
import { friendlyDbError } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

/** Messages sent for one ticket, newest first; failures stand out (spec §7.10). */
export function TicketMessages({
  ticketId,
  timeZone,
  refreshKey,
  onCompose,
  onChanged,
}: {
  ticketId: string;
  timeZone: string;
  /** Bump to reload after a send. */
  refreshKey: number;
  onCompose: () => void;
  onChanged: () => void;
}) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMessages(await fetchTicketMessages(ticketId));
    } catch (e) {
      setError(friendlyDbError(e));
    }
  }, [ticketId]);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);
  // Delivery updates arrive from the provider a few seconds later.
  useEffect(() => {
    if (
      !messages?.some((m) => m.status === "queued" || m.status === "sending" || m.status === "sent")
    )
      return;
    const t = setTimeout(() => void load(), 8000);
    return () => clearTimeout(t);
  }, [messages, load]);

  async function cancel(id: string) {
    const { error: err } = await getSupabase().rpc("cancel_message", { p_message_id: id });
    if (err) setError(friendlyDbError(err));
    await load();
    onChanged();
  }

  return (
    <Panel title="Messages">
      <div className="flex flex-col gap-3">
        <Button variant="outline" className="self-start" onClick={onCompose}>
          <Send /> Message customer
        </Button>
        {error ? <p className="text-danger">{error}</p> : null}
        {messages === null ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-muted-foreground">No messages yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((m) => {
              const Icon = m.channel === "sms" ? MessageSquare : Mail;
              const failed = m.status === "failed";
              return (
                <li
                  key={m.id}
                  className={cn(
                    "rounded-md border p-3",
                    failed ? "border-danger bg-danger/5" : "border-border",
                  )}
                >
                  <div className="flex items-center gap-2 text-sm">
                    <Icon className="size-4 text-muted-foreground" aria-hidden />
                    <span className={cn("font-medium", failed && "text-danger")}>
                      {failed ? <AlertTriangle className="mr-1 inline size-4" aria-hidden /> : null}
                      {m.status === "queued" && m.queued_for_quiet_hours
                        ? `Quiet hours: sends ${shopTime(m.scheduled_for, timeZone)}`
                        : STATUS_TEXT[m.status]}
                    </span>
                    <span className="ml-auto text-muted-foreground">
                      {shopTime(m.created_at, timeZone)}
                    </span>
                  </div>
                  {m.subject ? <p className="mt-1 font-medium">{m.subject}</p> : null}
                  <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                  {failed && m.error ? <p className="mt-1 text-sm text-danger">{m.error}</p> : null}
                  {m.status === "canceled" && m.error ? (
                    <p className="mt-1 text-sm text-muted-foreground">{m.error}</p>
                  ) : null}
                  {m.status === "queued" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-1"
                      onClick={() => void cancel(m.id)}
                    >
                      <X /> Don't send
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}
