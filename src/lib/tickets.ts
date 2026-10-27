import { getSupabase } from "./supabase";

// Client-side types and queries for Phase 2. All access is checked by RLS and
// the database functions (supabase/migrations/*_customers_tickets.sql).

export type StatusCategory = "open" | "waiting" | "ready" | "closed";
export type Status = {
  id: string;
  name: string;
  position: number;
  category: StatusCategory;
  color: "received" | "in-progress" | "waiting" | "ready" | "closed";
  notify_by_default: boolean;
  is_final: boolean;
};
export type CustomField = {
  id: string;
  label: string;
  field_type: "text" | "number" | "date" | "select";
  options: string[];
  required: boolean;
  position: number;
  help_text: string | null;
};
export type Customer = {
  id: string;
  name: string;
  preferred_channel: "sms" | "email";
  sms_opted_out: boolean;
  email_opted_out: boolean;
  /** Decision 77: when and how texts were turned off (customer page only). */
  sms_opted_out_at?: string | null;
  sms_opt_out_source?: "stop" | "staff" | null;
  notes: string | null;
  created_at: string;
};
export type Ticket = {
  id: string;
  shop_id: string;
  ticket_number: number;
  customer_id: string;
  item_name: string;
  item_description: string | null;
  issue_description: string | null;
  status_id: string;
  status_changed_at: string;
  assigned_to: string | null;
  promised_date: string | null;
  custom_fields: Record<string, string | number>;
  has_passcode: boolean;
  internal_notes: string | null;
  customer_notes: string | null;
  terms_accepted_at: string | null;
  picked_up_at: string | null;
  created_by: string | null;
  updates_consent: boolean;
  updates_consent_at: string | null;
  updates_consent_by: string | null;
  created_at: string;
  customer?: {
    id: string;
    name: string;
    sms_opted_out: boolean;
    email_opted_out: boolean;
    /** Decision 77: when and how texts were turned off. */
    sms_opted_out_at: string | null;
    sms_opt_out_source: "stop" | "staff" | null;
  } | null;
};
export type Member = { user_id: string; role: string; name: string; email: string };

/**
 * How a team member is shown: their name, or the part of their email before
 * the @ when they haven't set one (Oz, 24 Oct: short enough for a phone, and
 * two people without names can still be told apart). Same rule everywhere.
 */
export function memberName(m: Pick<Member, "name" | "email">): string {
  return m.name?.trim() || m.email?.split("@")[0] || "A team member";
}

const TICKET_COLUMNS =
  "id, shop_id, ticket_number, customer_id, item_name, item_description, issue_description, status_id, status_changed_at, assigned_to, promised_date, custom_fields, has_passcode, internal_notes, customer_notes, terms_accepted_at, picked_up_at, created_by, updates_consent, updates_consent_at, updates_consent_by, created_at, customer:customers(id, name, sms_opted_out, email_opted_out, sms_opted_out_at, sms_opt_out_source)";

export async function fetchStatuses(shopId: string): Promise<Status[]> {
  const { data, error } = await getSupabase()
    .from("statuses")
    .select("id, name, position, category, color, notify_by_default, is_final")
    .eq("shop_id", shopId)
    .order("position");
  if (error) throw error;
  return (data ?? []) as Status[];
}

export async function fetchCustomFields(shopId: string): Promise<CustomField[]> {
  const { data, error } = await getSupabase()
    .from("custom_field_definitions")
    .select("id, label, field_type, options, required, position, help_text")
    .eq("shop_id", shopId)
    .order("position");
  if (error) throw error;
  return (data ?? []) as CustomField[];
}

export async function fetchTickets(shopId: string): Promise<Ticket[]> {
  const { data, error } = await getSupabase()
    .from("tickets")
    .select(TICKET_COLUMNS)
    .eq("shop_id", shopId)
    .order("ticket_number", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as unknown as Ticket[];
}

export async function fetchTicket(ticketId: string): Promise<Ticket | null> {
  const { data, error } = await getSupabase()
    .from("tickets")
    .select(TICKET_COLUMNS)
    .eq("id", ticketId)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as Ticket | null;
}

export async function fetchMembers(shopId: string): Promise<Member[]> {
  const sb = getSupabase();
  const { data: rows, error } = await sb
    .from("memberships")
    .select("user_id, role")
    .eq("shop_id", shopId);
  if (error) throw error;
  const ids = (rows ?? []).map((r) => r.user_id as string);
  const { data: profiles } = await sb
    .from("profiles")
    .select("user_id, full_name, email")
    .in("user_id", ids);
  const byId = new Map((profiles ?? []).map((p) => [p.user_id as string, p]));
  return (rows ?? []).map((r) => ({
    user_id: r.user_id as string,
    role: r.role as string,
    name: (byId.get(r.user_id)?.full_name as string) || "",
    email: (byId.get(r.user_id)?.email as string) || "",
  }));
}

export async function fetchContacts(
  customerIds: string[],
): Promise<Map<string, { phone: string | null; email: string | null }>> {
  if (!customerIds.length) return new Map();
  const { data, error } = await getSupabase().rpc("customer_contacts", {
    p_customer_ids: customerIds,
  });
  if (error) throw error;
  return new Map(
    ((data ?? []) as { customer_id: string; phone: string | null; email: string | null }[]).map(
      (r) => [r.customer_id, { phone: r.phone, email: r.email }],
    ),
  );
}

export function shopToday(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isOverdue(
  t: Pick<Ticket, "promised_date">,
  status: Status | undefined,
  today: string,
): boolean {
  if (!t.promised_date || !status) return false;
  if (status.category === "ready" || status.category === "closed") return false;
  return t.promised_date < today;
}

/**
 * Due today or tomorrow and not Ready yet (Oz, 27 Oct): the card turns yellow.
 * Once the date has passed it is overdue (red) instead.
 */
export function isDueSoon(
  t: Pick<Ticket, "promised_date">,
  status: Status | undefined,
  today: string,
): boolean {
  if (!t.promised_date || !status) return false;
  if (status.category === "ready" || status.category === "closed") return false;
  const [y, m, d] = today.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
  return t.promised_date >= today && t.promised_date <= tomorrow;
}

export function isUnclaimed(
  t: Pick<Ticket, "status_changed_at">,
  status: Status | undefined,
  days: number,
  now = new Date(),
): boolean {
  if (!status || status.category !== "ready") return false;
  return now.getTime() - new Date(t.status_changed_at).getTime() > days * 86_400_000;
}

/** A message as the Board needs it to tell whether a Ready customer was told. */
export type ContactMessage = {
  ticket_id: string;
  channel: "sms" | "email";
  status: "queued" | "sending" | "sent" | "delivered" | "failed" | "canceled";
  created_at: string;
  /** For status updates (decision 138): the status the message was about. */
  kind?: string;
  status_id?: string | null;
};
export type ReadyContact =
  | { state: "none" }
  | { state: "sent" | "pending" | "failed"; channel: "sms" | "email"; at: string };

/**
 * Whether the customer heard from the shop since the ticket became Ready
 * (Oz, 23 Oct): a sent or delivered message wins, then one still waiting to
 * go (quiet hours, retry), then a failed one. Canceled messages don't count.
 * The update about this status itself counts even if it was sent before the
 * ticket last arrived here, so a quick trip out of Ready and back doesn't
 * undo "told" (Oz, 26 Oct; decision 138).
 */
export function readyContact(
  t: Pick<Ticket, "id" | "status_changed_at"> & { status_id?: string },
  messages: ContactMessage[],
): ReadyContact {
  const since = new Date(t.status_changed_at).getTime();
  const mine = messages
    .filter(
      (m) =>
        m.ticket_id === t.id &&
        m.status !== "canceled" &&
        (new Date(m.created_at).getTime() >= since ||
          (m.kind === "status" && !!m.status_id && m.status_id === t.status_id)),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const pick = (states: ContactMessage["status"][]) => mine.find((m) => states.includes(m.status));
  for (const [state, states] of [
    ["sent", ["sent", "delivered"]],
    ["pending", ["queued", "sending"]],
    ["failed", ["failed"]],
  ] as const) {
    const m = pick([...states]);
    if (m) return { state, channel: m.channel, at: m.created_at };
  }
  return { state: "none" };
}

/** How many picked-up tickets the board shows; the rest are in the List (Oz, 27 Oct). */
export const BOARD_CLOSED_LIMIT = 10;

/**
 * A status's cards on the board. Open columns show every ticket; a closed
 * column (Picked up) shows the latest BOARD_CLOSED_LIMIT by when they moved
 * there (Oz, 27 Oct: replaces the 7-day rule). `total` counts them all.
 */
export function boardColumn<T extends Pick<Ticket, "status_id" | "status_changed_at">>(
  tickets: T[],
  status: Status,
): { shown: T[]; total: number } {
  const all = tickets.filter((t) => t.status_id === status.id);
  if (status.category !== "closed") return { shown: all, total: all.length };
  const latest = [...all].sort((a, b) => b.status_changed_at.localeCompare(a.status_changed_at));
  return { shown: latest.slice(0, BOARD_CLOSED_LIMIT), total: all.length };
}

export function initials(nameOrEmail: string): string {
  const parts = nameOrEmail.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export const STATUS_COLOR_CLASS: Record<Status["color"], string> = {
  received: "bg-status-received",
  "in-progress": "bg-status-in-progress",
  waiting: "bg-status-waiting",
  ready: "bg-status-ready",
  closed: "bg-status-closed",
};

/** Soft status tints for value chips in tables (decision 103); text stays near-black. */
export const STATUS_TINT_CLASS: Record<Status["color"], string> = {
  received: "bg-status-received/15",
  "in-progress": "bg-status-in-progress/15",
  waiting: "bg-status-waiting/15",
  ready: "bg-status-ready/15",
  closed: "bg-status-closed/15",
};

export async function signedPhotoUrls(paths: string[]): Promise<Map<string, string>> {
  if (!paths.length) return new Map();
  const { data, error } = await getSupabase()
    .storage.from("ticket-photos")
    .createSignedUrls(paths, 600);
  if (error) throw error;
  const out = new Map<string, string>();
  for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
  return out;
}

export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export async function uploadPhotos(
  shopId: string,
  ticketId: string,
  files: File[],
): Promise<string[]> {
  const sb = getSupabase();
  const problems: string[] = [];
  for (const file of files) {
    if (!PHOTO_TYPES.includes(file.type)) {
      problems.push(`${file.name}: only photos (JPEG, PNG, WebP, HEIC) can be added.`);
      continue;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      problems.push(`${file.name}: photos must be 10 MB or smaller.`);
      continue;
    }
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${shopId}/${ticketId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await sb.storage
      .from("ticket-photos")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      problems.push(`${file.name}: upload failed.`);
      continue;
    }
    const { error } = await sb
      .from("ticket_photos")
      .insert({ shop_id: shopId, ticket_id: ticketId, storage_path: path });
    if (error) problems.push(`${file.name}: couldn't be saved.`);
  }
  return problems;
}
