import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";

import { PageHeader } from "@/components/app/EmptyState";
import { roleAtLeast } from "@/lib/shop";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/settings")({
  head: () => ({ meta: [{ title: "Settings · Mend" }] }),
  component: SettingsLayout,
});

function SettingsLayout() {
  const { membership } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAdmin = roleAtLeast(membership.role, "admin");
  const tabs = [
    { to: "/app/settings/shop", label: "Shop" },
    { to: "/app/settings/board", label: "Board & fields" },
    { to: "/app/settings/messages", label: "Messages" },
    { to: "/app/settings/taxes", label: "Taxes" },
    { to: "/app/settings/team", label: "Team" },
    { to: "/app/settings/security", label: "Security" },
    ...(isAdmin ? [{ to: "/app/settings/audit", label: "Audit log" }] : []),
  ] as const;

  return (
    <>
      <PageHeader title="Settings" />
      <nav
        aria-label="Settings sections"
        className="mb-6 flex flex-wrap gap-2 border-b border-border"
      >
        {tabs.map((t) => {
          const active = pathname.startsWith(t.to);
          return (
            <Link
              key={t.to}
              to={t.to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px flex h-11 items-center border-b-2 px-4 text-[0.9375rem] font-medium transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <Outlet />
    </>
  );
}
