import { toast } from "sonner";

import { shopTime } from "@/lib/messages";
import { messageWhat, SEND_DELAY_MS } from "@/lib/notifications";
import { friendlyDbError } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";

// Message confirmations are toasts, bottom left (Oz, 26 Oct; decision 138):
// "sent" and "scheduled" close by themselves after 5 seconds; a message held
// because its ticket moved stays until someone answers it.

const word = (channel: "sms" | "email") => (channel === "sms" ? "Text" : "Email");

async function cancel(messageId: string) {
  const { error } = await getSupabase().rpc("cancel_message", { p_message_id: messageId });
  if (error) toast.error(friendlyDbError(error));
  else toast("Canceled. Nothing was sent.");
}

/** After queue_message: when the message goes out, with Undo. */
export function toastQueued(m: {
  messageId: string;
  channel: "sms" | "email";
  who: string;
  scheduledFor: string;
  quietHours: boolean;
  timeZone: string;
}): void {
  const at = new Date(m.scheduledFor).getTime();
  const title = m.quietHours
    ? `Quiet hours: the ${word(m.channel).toLowerCase()} to ${m.who} goes out ${shopTime(m.scheduledFor, m.timeZone)}`
    : at - Date.now() > SEND_DELAY_MS + 5_000
      ? `${word(m.channel)} to ${m.who} scheduled for ${shopTime(m.scheduledFor, m.timeZone)}`
      : `${word(m.channel)} to ${m.who} goes out in 20 seconds.`;
  toast(title, { action: { label: "Undo", onClick: () => void cancel(m.messageId) } });
}

type Held = { id: string; channel: "sms" | "email"; kind: string; body: string };

/**
 * After a status change: set_ticket_status holds the ticket's messages that
 * haven't gone out. Ask whoever moved it, one toast per message, until they
 * answer: Send, Don't send, or closing the toast (which sends). Without an
 * answer the server sends it a minute later anyway.
 */
export async function promptHeldMessages(t: {
  ticketId: string;
  ticketNumber: number;
  statusName: string;
  who: string;
}): Promise<void> {
  const { data } = await getSupabase()
    .from("messages")
    .select("id, channel, kind, body")
    .eq("ticket_id", t.ticketId)
    .eq("status", "queued")
    .not("held_at", "is", null);
  for (const m of (data ?? []) as Held[]) {
    let decided = false;
    const send = async () => {
      decided = true;
      const { error } = await getSupabase().rpc("release_held_message", { p_message_id: m.id });
      if (error) toast.error(friendlyDbError(error));
      else toast(`${word(m.channel)} to ${t.who} goes out shortly.`);
    };
    const snippet = m.body.length > 90 ? `${m.body.slice(0, 90)}…` : m.body;
    toast(`#${t.ticketNumber} moved to ${t.statusName}.`, {
      description: `Still send ${messageWhat(m.kind, m.channel)} to ${t.who}? “${snippet}”`,
      duration: Infinity,
      closeButton: true,
      action: { label: "Send", onClick: () => void send() },
      cancel: {
        label: "Don't send",
        onClick: () => {
          decided = true;
          void cancel(m.id);
        },
      },
      onDismiss: () => {
        if (!decided) void send();
      },
    });
  }
}
