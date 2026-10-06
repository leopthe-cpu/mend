import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AppSidebar } from "@/components/app/AppSidebar";
import { TopBar } from "@/components/app/TopBar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getSupabase } from "@/lib/supabase";

// The signed-in app. Rendered in the browser only: the session lives in the
// browser, and this guard is a convenience, not a security boundary. Data
// access is enforced by RLS in the database on every request (spec §3).
export const Route = createFileRoute("/app")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await getSupabase().auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
    return { user: data.session.user };
  },
  component: AppLayout,
});

// Below this width (tablets at the counter) the nav starts collapsed to icons;
// phones get a drawer (handled inside the shadcn Sidebar). Spec §8.4.
const TABLET_MAX = 1280;

function AppLayout() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(true);

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

  const name =
    typeof user.user_metadata["full_name"] === "string" ? user.user_metadata["full_name"] : "";

  return (
    <SidebarProvider open={navOpen} onOpenChange={setNavOpen}>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <AppSidebar
        userLabel={name || user.email || ""}
        onSignOut={() => void getSupabase().auth.signOut()}
      />
      <SidebarInset className="min-w-0 bg-background">
        <TopBar />
        <main id="main" className="flex-1 px-4 py-6 md:px-8">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
