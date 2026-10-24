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
import { AppRail, PhoneTabBar } from "@/components/app/AppRail";
import { TopBar } from "@/components/app/TopBar";
import { UnsavedChangesDialog } from "@/components/app/UnsavedChangesDialog";
import { LEGAL } from "@/lib/legal";
import {
  forgetAppData,
  loadAppData,
  missingTextContact,
  roleAtLeast,
  shopAttention,
} from "@/lib/shop";
import { getSupabase, SupabaseConfigError } from "@/lib/supabase";
import { UnsavedContext, UnsavedRegistry } from "@/lib/unsaved";

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
    const { membership, profile } = await loadAppData(session.user.id);
    if (!membership) {
      forgetAppData();
      throw redirect({ to: "/onboarding" });
    }
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

function AppLayout() {
  const { membership, displayName, termsVersion } = Route.useRouteContext();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Decision 53: the shop starts with defaults; keep a way back to setup in
  // view until the Owner (or an Admin) finishes it.
  const showSetup =
    !membership.shop.setup_completed_at &&
    roleAtLeast(membership.role, "admin") &&
    pathname !== "/app/setup";
  // Settings › Shop is missing details customers would notice: dot the way
  // there for the people who can fix it (Owner/Admin).
  const settingsAttention =
    roleAtLeast(membership.role, "admin") && shopAttention(membership.shop).length > 0;
  // Decision 131: setup can be skipped without an address and phone, but the
  // database refuses texts until both are set. Say so where it can be fixed
  // (Owner/Admin); Staff see the reason when they try to text.
  const showTextContact =
    !showSetup &&
    missingTextContact(membership.shop) &&
    roleAtLeast(membership.role, "admin") &&
    pathname !== "/app/settings/shop";

  // Signed out in another tab, or the session ended: leave the app.
  useEffect(() => {
    const { data } = getSupabase().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        forgetAppData();
        void navigate({ to: "/login", replace: true });
      }
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  const signOut = () => void getSupabase().auth.signOut();
  const [unsaved] = useState(() => new UnsavedRegistry());

  return (
    <UnsavedContext.Provider value={unsaved}>
      <div className="min-h-svh bg-background text-foreground">
        <a
          href="#main"
          className="sr-only z-50 rounded-full bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        {/* Floating rail on tablets and computers, tab bar on phones (decision 92). */}
        <AppRail
          userLabel={displayName}
          role={membership.role}
          attention={settingsAttention}
          onSignOut={signOut}
        />
        <PhoneTabBar
          shopName={membership.shop.name}
          userLabel={displayName}
          attention={settingsAttention}
          onSignOut={signOut}
        />
        <div className="min-w-0 pb-24 md:pb-0 md:pl-[6.5rem]">
          <TopBar membership={membership} />
          <main id="main" className="px-4 pb-8 md:pr-6 md:pl-0">
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
            {showTextContact ? (
              <ActionBanner
                tone="orange"
                text="Texts to customers are off until then. Your texts link to a page with them."
              >
                <Link to="/app/settings/shop" className={BANNER_TARGET}>
                  Add your shop's address and phone
                </Link>
              </ActionBanner>
            ) : null}
            <TermsBanner acceptedVersion={termsVersion} />
            {roleAtLeast(membership.role, "admin") ? (
              <RetentionBanner shopId={membership.shop.id} />
            ) : null}
            <Outlet />
          </main>
        </div>
        <UnsavedChangesDialog registry={unsaved} />
      </div>
    </UnsavedContext.Provider>
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
          else {
            forgetAppData();
            setAccepted(true);
          }
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
