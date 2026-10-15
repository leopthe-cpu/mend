import { getSupabase } from "@/lib/supabase";

// Customer messages (spec §7.10). The browser renders templates for the
// preview; the member can edit the text, and what they confirm is what the
// database queues (queue_message enforces opt-outs, limits and quiet hours).
// PR 8: three templates per shop — Ticket created, Ticket ready, Reminder —
// plus an automatic "created" message.  The SQL renderer in the migration and
// renderTemplate below keep the same variables and substitution rules.

export type Channel = "sms" | "email";
export type MessageStatus = "queued" | "sending" | "sent" | "delivered" | "failed" | "canceled";
export type MessageKind = "status" | "created" | "reminder";
export type Message = {
  id: string;
  ticket_id: string;
  customer_id: string;
  channel: Channel;
  kind: MessageKind;
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
  kind: MessageKind;
  status_id: string | null;
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
  "{customer_first_name}",
  "{customer_name}",
  "{ticket_title}",
  "{item_name}",
  "{shop_name}",
  "{ticket_number}",
  "{promised_date}",
  "{shop_hours}",
  "{pickup_hours}",
  "{amount_due}",
  "{payment_line}",
] as const;

export type TemplateVars = {
  customer_first_name: string;
  customer_name: string;
  item_name: string;
  ticket_title: string;
  shop_name: string;
  ticket_number: number;
  pickup_hours: string;
  shop_hours: string;
  promised_date: string;
  amount_due: string;
  payment_line: string;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-20" -> "Tue, Oct 20" (matches SQL to_char(date, 'Dy, Mon DD')). */
export function formatPromisedDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "a date to be confirmed";
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Pure substitution: replace every {key} in vars with its value, then trim. */
export function renderTemplate(text: string, vars: Partial<TemplateVars>): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(v === undefined || v === null ? "" : String(v));
  }
  return out.trim();
}

export const DEFAULT_TEMPLATES: Record<
  "created" | "reminder",
  Record<Channel, { subject: string; body: string }>
> = {
  created: {
    sms: {
      subject: "",
      body: "Hi {customer_first_name}, thanks for visiting {shop_name}. Your order {ticket_title} (#{ticket_number}) will be ready on {promised_date}. {payment_line}",
    },
    email: {
      subject: "Your {ticket_title} at {shop_name}",
      body: "Hi {customer_first_name}, thanks for visiting {shop_name}. Your order {ticket_title} (#{ticket_number}) will be ready on {promised_date}. {payment_line}",
    },
  },
  reminder: {
    sms: {
      subject: "",
      body: "Hi {customer_first_name}, a reminder that your {ticket_title} is ready for pickup at {shop_name}. {shop_hours}",
    },
    email: {
      subject: "Reminder: your {ticket_title} is ready for pickup",
      body: "Hi {customer_first_name}, a reminder that your {ticket_title} is ready for pickup at {shop_name}. {shop_hours}",
    },
  },
};

export const REMINDER_TEMPLATE = DEFAULT_TEMPLATES.reminder.sms.body;

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
  const units = text.length;
  const segments = units <= 70 ? 1 : Math.ceil(units / 67);
  return { encoding: "UCS-2", units, segments, perSegment: units <= 70 ? 70 : 67 };
}

export async function fetchTemplates(shopId: string): Promise<Template[]> {
  const { data, error } = await getSupabase()
    .from("message_templates")
    .select("id, kind, status_id, channel, subject, body")
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

export function kickSender(): void {
  void getSupabase()
    .functions.invoke("send-messages", { body: {} })
    .catch(() => undefined);
}

export function shopTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
