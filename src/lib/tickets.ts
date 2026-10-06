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
  created_at: string;
  customer?: { id: string; name: string } | null;
};
export type Member = { user_id: string; role: string; name: string; email: string };

const TICKET_COLUMNS =
  "id, shop_id, ticket_number, customer_id, item_name, item_description, issue_description, status_id, status_changed_at, assigned_to, promised_date, custom_fields, has_passcode, internal_notes, customer_notes, terms_accepted_at, picked_up_at, created_at, customer:customers(id, name)";

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

/** "Today" in the shop's time zone as YYYY-MM-DD (spec §6: date-only fields use the shop's zone). */
export function shopToday(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Overdue: promised date has passed and the ticket isn't ready or closed (spec §7.3). */
export function isOverdue(
  t: Pick<Ticket, "promised_date">,
  status: Status | undefined,
  today: string,
): boolean {
  if (!t.promised_date || !status) return false;
  if (status.category === "ready" || status.category === "closed") return false;
  return t.promised_date < today;
}

/** Unclaimed: in a ready status longer than the shop's reminder days (spec §7.3). */
export function isUnclaimed(
  t: Pick<Ticket, "status_changed_at">,
  status: Status | undefined,
  days: number,
  now = new Date(),
): boolean {
  if (!status || status.category !== "ready") return false;
  return now.getTime() - new Date(t.status_changed_at).getTime() > days * 86_400_000;
}

/** Closed tickets leave the board after 7 days (spec §7.3 suggestion) but stay in the list. */
export function onBoard(
  t: Pick<Ticket, "status_changed_at">,
  status: Status | undefined,
  now = new Date(),
): boolean {
  if (!status || status.category !== "closed") return true;
  return now.getTime() - new Date(t.status_changed_at).getTime() <= 7 * 86_400_000;
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

/** Signed, short-lived URLs for private photos (spec §4: 10 minutes). */
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

/** Uploads intake photos to <shop>/<ticket>/<uuid>.<ext> and records them. */
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
