import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ActionBanner } from "@/components/app/ActionBanner";
import { AppSidebar } from "@/components/app/AppSidebar";
import { TopBar } from "@/components/app/TopBar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { LEGAL } from "@/lib/legal";
import { fetchMyMembership, roleAtLeast } from "@/lib/shop";
import { getSupabase, SupabaseConfigError } from "@/lib/supabase";

// The signed-in app. Rendered in the browser only: the session lives in the
// browser, and this guard is a convenience, not a security boundary. Data
// access is enforced by RLS in the database on every request (spec §3).
export const Route = createFileRoute("/app")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    let session = null;
    try {
      session = (await getSupabase().auth.getSession()).data.session;
    } catch (error) {
      // Not configured in this environment: treat as signed out; the login
      // form explains what's missing.
      if (!(error instanceof SupabaseConfigError)) throw error;
    }
    if (!session) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
    // Two-factor: if this account has a verified factor, the session must have
    // passed it (aal2) before entering the app (spec §4, Settings → Security).
    const { data: aal } = await getSupabase().auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      throw redirect({ to: "/mfa", search: { redirect: location.href } });
    }
    const membership = await fetchMyMembership(session.user.id);
    if (!membership) throw redirect({ to: "/onboarding" });
    const { data: profile } = await getSupabase()
      .from("profiles")
      .select("full_name, terms_version")
      .eq("user_id", session.user.id)
      .maybeSingle();
    // Decision 19: show the email until the person adds their name.
    const displayName = profile?.full_name?.trim() || session.user.email || "";
    return {
      user: session.user,
      membership,
      displayName,
      termsVersion: (profile?.terms_version as string | null | undefined) ?? null,
    };
  },
  component: AppLayout,
});

// Below this width (tablets at the counter) the nav starts collapsed to icons;
// phones get a drawer (handled inside the shadcn Sidebar). Spec §8.4.
const TABLET_MAX = 1280;

function AppLayout() {
  const { membership, displayName, termsVersion } = Route.useRouteContext();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(true);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Decision 53: the shop starts with defaults; keep a way back to setup in
  // view until the Owner (or an Admin) finishes it.
  const showSetup =
    !membership.shop.setup_completed_at &&
    roleAtLeast(membership.role, "admin") &&
    pathname !== "/app/setup";

  useEffect(() => {
    if (window.innerWidth < TABLET_MAX) setNavOpen(false);
  }, []);

  // Signed out in another tab, or the session ended: leave the app.
  useEffect(() => {
    const { data } = getSupabase().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        void navigate({ to: "/login", replace: true });
      }
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  return (
    <SidebarProvider open={navOpen} onOpenChange={setNavOpen}>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <AppSidebar
        userLabel={displayName}
        shopName={membership.shop.name}
        onSignOut={() => void getSupabase().auth.signOut()}
      />
      {/* Light grey main view, dark nav (decision 21) */}
      <SidebarInset className="min-w-0 bg-background text-foreground">
        <TopBar membership={membership} />
        <main id="main" className="flex-1 px-4 py-6 md:px-8">
          {showSetup ? (
            <ActionBanner
              tone="orange"
              text="Add your shop name, trade, pickup hours and taxes. It takes about two minutes."
            >
              <Link to="/app/setup" className={BANNER_TARGET}>
                Finish setting up your shop
              </Link>
            </ActionBanner>
          ) : null}
          <TermsBanner acceptedVersion={termsVersion} />
          {roleAtLeast(membership.role, "admin") ? (
            <RetentionBanner shopId={membership.shop.id} />
          ) : null}
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

// Accounts created before sign-up recorded acceptance, and everyone after a
// terms update (LEGAL.version changes), see this until they accept
// (docs/legal-compliance.md §7 item 2). Acceptance is stored server-side by
// public.accept_terms.
function TermsBanner({ acceptedVersion }: { acceptedVersion: string | null }) {
  const [accepted, setAccepted] = useState(acceptedVersion === LEGAL.version);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (accepted) return null;
  return (
    <ActionBanner
      tone="green"
      extra={
        <>
          Read the{" "}
          <Link to="/terms" target="_blank" className="underline underline-offset-4">
            terms of service
          </Link>{" "}
          and{" "}
          <Link to="/privacy" target="_blank" className="underline underline-offset-4">
            privacy policy
          </Link>{" "}
          (effective {LEGAL.effectiveDate}).
          {error ? <span className="mt-1 block text-destructive">{error}</span> : null}
        </>
      }
    >
      <button
        type="button"
        className={`${BANNER_TARGET} text-left`}
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          setError(null);
          const { error } = await getSupabase().rpc("accept_terms", {
            p_version: LEGAL.version,
          });
          setSaving(false);
          if (error) setError("That didn't save. Try again.");
          else setAccepted(true);
        }}
      >
        {saving ? "Saving…" : "Please review our terms, then tap here to agree"}
      </button>
    </ActionBanner>
  );
}

// Decision 86: 30 days before closed tickets are cleared, Owners and Admins
// are told how many and from when, with a way to download first.
function RetentionBanner({ shopId }: { shopId: string }) {
  const [notice, setNotice] = useState<{ count: number; first: string } | null>(null);
  useEffect(() => {
    void getSupabase()
      .rpc("retention_notice", { p_shop_id: shopId })
      .then(({ data }) => {
        const row = (data as { tickets_due: number; first_due: string | null }[] | null)?.[0];
        if (row && row.tickets_due > 0 && row.first_due)
          setNotice({ count: row.tickets_due, first: row.first_due });
      });
  }, [shopId]);
  if (!notice) return null;
  // first_due is already a date in the shop's time zone (retention_notice).
  const date = new Intl.DateTimeFormat("en-CA", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${notice.first}T00:00:00Z`));
  return (
    <ActionBanner
      tone="orange"
      text={`Photos, messages and notes of ${notice.count} ticket${notice.count === 1 ? "" : "s"} closed a year ago will be deleted from ${date}. Download your data first if you need it.`}
    >
      <Link to="/app/settings/data" className={BANNER_TARGET}>
        Old tickets will be cleared soon
      </Link>
    </ActionBanner>
  );
}

// The banner's main control covers the whole banner (ActionBanner).
const BANNER_TARGET = "font-semibold outline-none after:absolute after:inset-0 after:content-['']";
