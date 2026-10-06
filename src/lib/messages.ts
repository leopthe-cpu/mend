import { getSupabase } from "@/lib/supabase";

// Customer messages (spec §7.10). The browser renders templates for the
// preview; the member can edit the text, and what they confirm is what the
// database queues (queue_message enforces opt-outs, limits and quiet hours).

export type Channel = "sms" | "email";
export type MessageStatus = "queued" | "sending" | "sent" | "delivered" | "failed" | "canceled";
export type Message = {
  id: string;
  ticket_id: string;
  customer_id: string;
  channel: Channel;
  kind: "status" | "reminder" | "manual";
  subject: string | null;
  body: string;
  status: MessageStatus;
  scheduled_for: string;
  queued_for_quiet_hours: boolean;
  error: string | null;
  sent_by: string | null;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
};
export type Template = {
  id: string;
  status_id: string;
  channel: Channel;
  subject: string | null;
  body: string;
};

export const STATUS_TEXT: Record<MessageStatus, string> = {
  queued: "Waiting to send",
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  failed: "Failed",
  canceled: "Canceled",
};

export const VARIABLES = [
  "{customer_name}",
  "{item_name}",
  "{shop_name}",
  "{ticket_number}",
  "{pickup_hours}",
] as const;

export type TemplateVars = {
  customer_name: string;
  item_name: string;
  shop_name: string;
  ticket_number: number;
  pickup_hours: string;
};

/** Replace the five spec variables; unknown {words} are left as typed. */
export function renderTemplate(text: string, v: TemplateVars): string {
  return text
    .replaceAll("{customer_name}", v.customer_name.split(" ")[0] || v.customer_name)
    .replaceAll("{item_name}", v.item_name)
    .replaceAll("{shop_name}", v.shop_name)
    .replaceAll("{ticket_number}", `#${v.ticket_number}`)
    .replaceAll("{pickup_hours}", v.pickup_hours)
    .replace(/[ \t]+$/gm, "")
    .trim();
}

export const REMINDER_TEMPLATE =
  "Hi {customer_name}, a reminder that your {item_name} is ready for pickup at {shop_name}. {pickup_hours}";

// GSM 03.38 default alphabet and extension table (extension characters take
// two septets). Anything else forces UCS-2: 70 characters per single SMS,
// 67 per part when split; GSM-7 is 160 / 153.
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXT = "^{}\\[~]|€\f";

export function smsSegments(text: string): {
  encoding: "GSM-7" | "UCS-2";
  units: number;
  segments: number;
  perSegment: number;
} {
  let septets = 0;
  let gsm = true;
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) septets += 1;
    else if (GSM_EXT.includes(ch)) septets += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) {
    const segments = septets <= 160 ? 1 : Math.ceil(septets / 153);
    return { encoding: "GSM-7", units: septets, segments, perSegment: septets <= 160 ? 160 : 153 };
  }
  // UCS-2 counts UTF-16 code units (emoji take two).
  const units = text.length;
  const segments = units <= 70 ? 1 : Math.ceil(units / 67);
  return { encoding: "UCS-2", units, segments, perSegment: units <= 70 ? 70 : 67 };
}

export async function fetchTemplates(shopId: string): Promise<Template[]> {
  const { data, error } = await getSupabase()
    .from("message_templates")
    .select("id, status_id, channel, subject, body")
    .eq("shop_id", shopId);
  if (error) throw error;
  return (data ?? []) as Template[];
}

export async function fetchTicketMessages(ticketId: string): Promise<Message[]> {
  const { data, error } = await getSupabase()
    .from("messages")
    .select("*")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Message[];
}

/**
 * Ask the sender to go now. Fire and forget: if this call fails, the
 * every-minute job still sends the message.
 */
export function kickSender(): void {
  void getSupabase()
    .functions.invoke("send-messages", { body: {} })
    .catch(() => undefined);
}

/** "8:00 AM" style time in the shop's zone. */
export function shopTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
