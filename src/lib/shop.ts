import { getSupabase } from "./supabase";

// Client-side view of the tenancy model (supabase/migrations/*_tenancy_core.sql).
// The UI uses roles only to hide what a role can't do; the database enforces
// every rule (RLS + RPCs), whatever the UI shows.

export type Role = "owner" | "admin" | "staff";
export type Vertical = "electronics" | "ski" | "tailoring" | "other";

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
  business_hours: { text?: string };
  tax_registration_number: string | null;
  terms_text: string | null;
  unclaimed_reminder_days: number;
  quiet_hours_start: string;
  quiet_hours_end: string;
};

export type Membership = { role: Role; shop: Shop };

const RANK: Record<Role, number> = { owner: 3, admin: 2, staff: 1 };
export function roleAtLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", staff: "Staff" };

export const VERTICALS: { value: Vertical; label: string; hint: string }[] = [
  { value: "electronics", label: "Electronics and phone repair", hint: "Phones, tablets, laptops" },
  { value: "ski", label: "Ski and snowboard", hint: "Tunes, waxing, bindings" },
  { value: "tailoring", label: "Tailoring and cleaning", hint: "Alterations, dry cleaning" },
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
