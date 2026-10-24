import { getSupabase } from "./supabase";
import type { WeeklySchedule } from "./hours";

// Client-side view of the tenancy model (supabase/migrations/*_tenancy_core.sql).
// The UI uses roles only to hide what a role can't do; the database enforces
// every rule (RLS + RPCs), whatever the UI shows.

export type Role = "owner" | "admin" | "staff";
export type Vertical = "shoe_leather" | "watch" | "tailoring" | "electronics" | "ski" | "other";

export type Shop = {
  id: string;
  name: string;
  vertical: Vertical;
  country: "CA" | "US";
  currency: "CAD" | "USD";
  time_zone: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  business_hours: { text?: string; schedule?: WeeklySchedule };
  tax_registration_number: string | null;
  terms_text: string | null;
  unclaimed_reminder_days: number;
  quiet_hours_start: string;
  quiet_hours_end: string;
  sms_monthly_cap: number;
  logo_path: string | null;
  /** Null until the Owner finishes setup in the app (decision 53). */
  setup_completed_at: string | null;
  /** Code of the public contact page /s/<code> (decision 76). */
  public_code: string;
};

export type Membership = { role: Role; shop: Shop };

// Decision 131 (amends 76): texts must identify the shop (CASL), so the
// database refuses texts until the address and phone are both set. Setup and
// Settings no longer demand them; the app shows this reason wherever a text
// would be sent instead.
export const TEXTS_NEED_CONTACT =
  "Add your shop's address and phone in Settings → Shop to send texts.";
export function missingTextContact(shop: Pick<Shop, "address" | "phone">): boolean {
  return !shop.address?.trim() || !shop.phone?.trim();
}
/** Shop contact details Settings › Shop still needs (field ids on that page). */
export type AttentionField = "address" | "phone" | "email";
/**
 * What customers would notice is missing (Oz, 23 Oct): no address or phone
 * means no texts (decision 131), no email means customers can't reply to
 * emails. Drives the attention dots and the links to the exact field.
 */
export function shopAttention(shop: Pick<Shop, "address" | "phone" | "email">): AttentionField[] {
  const missing: AttentionField[] = [];
  if (!shop.address?.trim()) missing.push("address");
  if (!shop.phone?.trim()) missing.push("phone");
  if (!shop.email?.trim()) missing.push("email");
  return missing;
}
/** A phone number is usable when it has at least 10 digits (Canada/US). */
export function phoneComplete(phone: string): boolean {
  return phone.replace(/\D/g, "").length >= 10;
}

const RANK: Record<Role, number> = { owner: 3, admin: 2, staff: 1 };
export function roleAtLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

// Role names shown in the UI (decision 67). The account creator (owner) reads
// as "Admin" in most places; the Team page names it "Admin (owner)" so people
// can tell the account owner apart from a co-manager.
export const ROLE_LABEL: Record<Role, string> = {
  owner: "Admin",
  admin: "Admin (co-manager)",
  staff: "Team member",
};
export const TEAM_ROLE_LABEL: Record<Role, string> = {
  owner: "Admin (owner)",
  admin: "Admin (co-manager)",
  staff: "Team member",
};

// The trades the website speaks to come first (decision 52).
export const VERTICALS: { value: Vertical; label: string; hint: string }[] = [
  { value: "shoe_leather", label: "Shoe and leather repair", hint: "Resoles, heels, bags, belts" },
  { value: "watch", label: "Watch repair", hint: "Batteries, straps, servicing" },
  { value: "tailoring", label: "Tailoring and cleaning", hint: "Alterations, dry cleaning" },
  { value: "electronics", label: "Electronics and phone repair", hint: "Phones, tablets, laptops" },
  { value: "ski", label: "Ski and snowboard", hint: "Tunes, waxing, bindings" },
  { value: "other", label: "Something else", hint: "Any other repair work" },
];

// Canadian and US zones a shop is likely to be in (IANA names).
export const TIME_ZONES: { value: string; label: string }[] = [
  { value: "America/St_Johns", label: "Newfoundland (St. John's)" },
  { value: "America/Halifax", label: "Atlantic (Halifax)" },
  { value: "America/Toronto", label: "Eastern (Toronto)" },
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Winnipeg", label: "Central (Winnipeg)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Regina", label: "Saskatchewan (Regina)" },
  { value: "America/Edmonton", label: "Mountain (Edmonton)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Arizona (Phoenix)" },
  { value: "America/Vancouver", label: "Pacific (Vancouver)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Whitehorse", label: "Yukon (Whitehorse)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
];

export function guessTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (TIME_ZONES.some((z) => z.value === tz)) return tz;
  } catch {
    // fall through
  }
  return "America/Toronto";
}

// Zones in TIME_ZONES that are in the US; everything else there is Canadian.
const US_ZONES = new Set([
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
]);
export function countryForTimeZone(tz: string): "CA" | "US" {
  return US_ZONES.has(tz) ? "US" : "CA";
}

/** The signed-in user's shop and role, or null if they haven't onboarded. */
export async function fetchMyMembership(userId: string): Promise<Membership | null> {
  const { data, error } = await getSupabase()
    .from("memberships")
    .select("role, shop:shops(*)")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data as unknown as Membership;
}

/**
 * The signed-in person's shop and profile, for the app layout's guard. It
 * runs on every page change, so the result is kept for a few minutes instead
 * of costing two database round trips per click (19 Oct round 2, item 10;
 * decision 108). Anything that changes them calls forgetAppData() before
 * router.invalidate(); RLS still checks every request, so a stale copy can
 * only show an old name or role for a moment, never grant access.
 */
export type AppData = {
  membership: Membership | null;
  profile: { full_name: string | null; terms_version: string | null } | null;
};
const APP_DATA_TTL_MS = 5 * 60 * 1000;
let appData: { userId: string; at: number; value: Promise<AppData> } | null = null;

export function loadAppData(userId: string): Promise<AppData> {
  if (appData && appData.userId === userId && Date.now() - appData.at < APP_DATA_TTL_MS)
    return appData.value;
  // Both at once: one round trip instead of two in a row.
  const value = Promise.all([
    fetchMyMembership(userId),
    getSupabase()
      .from("profiles")
      .select("full_name, terms_version")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => (data as AppData["profile"]) ?? null),
  ]).then(([membership, profile]) => ({ membership, profile }));
  appData = { userId, at: Date.now(), value };
  // A failed load must not be remembered.
  value.catch(() => {
    if (appData?.value === value) appData = null;
  });
  return value;
}

export function forgetAppData(): void {
  appData = null;
}

/**
 * Our database functions raise short, plain messages (e.g. "the owner cannot
 * be removed"); show those. Anything else gets a generic message so internal
 * details never leak.
 */
export function friendlyDbError(error: unknown): string {
  const e = error as { code?: string; message?: string; hint?: string } | null;
  if (e?.hint === "reauthentication_needed") return "Please confirm your password again.";
  const ours = ["42501", "22023", "23505", "P0002", "54000"];
  if (e?.code && ours.includes(e.code) && e.message && e.message.length < 120) {
    if (e.message.startsWith("new row violates row-level security")) {
      return "You don't have permission to do that.";
    }
    if (e.message.startsWith("permission denied")) return "You don't have permission to do that.";
    return e.message.charAt(0).toUpperCase() + e.message.slice(1) + ".";
  }
  if (error instanceof TypeError) return "Can't reach Mend right now. Check your connection.";
  return "Something went wrong. Please try again.";
}
