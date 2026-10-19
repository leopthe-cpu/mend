import { Link, useRouterState } from "@tanstack/react-router";
import { LogOut, MoreHorizontal } from "lucide-react";
import { useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { appNav, phoneTabs } from "./nav";

// App navigation, Apple-style (decision 92, mockup approved 18 Oct): a
// floating rail of round icon buttons on tablets and computers, a bottom tab
// bar on phones with the rest of the pages under "More". Every icon has an
// accessible name; on the rail the name also shows on hover and focus.

function useActive() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (to: string) => pathname === to || pathname.startsWith(`${to}/`);
}

export function AppRail({ onSignOut }: { onSignOut: () => void }) {
  const isActive = useActive();
  return (
    <nav
      aria-label="Main"
      className="fixed top-4 bottom-4 left-4 z-30 hidden w-[4.5rem] flex-col items-center gap-3 rounded-[2.25rem] bg-card py-3 md:flex print:hidden"
    >
      <Link
        to="/app/board"
        aria-label="Mend home"
        className="flex size-14 items-center justify-center rounded-full bg-foreground text-xl font-bold tracking-tight text-background"
      >
        m<span className="text-[#64B5FF]">.</span>
      </Link>
      <div className="h-4" aria-hidden />
      {appNav.map(({ to, label, icon: Icon }) => {
        const active = isActive(to);
        return (
          <RailItem key={to} label={label}>
            <Link
              to={to}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex size-14 items-center justify-center rounded-full transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-foreground hover:bg-border/60",
              )}
            >
              <Icon aria-hidden className="size-[1.375rem]" />
            </Link>
          </RailItem>
        );
      })}
      <div className="flex-1" />
      <RailItem label="Sign out">
        <button
          type="button"
          onClick={onSignOut}
          aria-label="Sign out"
          className="flex size-14 cursor-pointer items-center justify-center rounded-full bg-background text-foreground transition-colors hover:bg-border/60"
        >
          <LogOut aria-hidden className="size-[1.375rem]" />
        </button>
      </RailItem>
    </nav>
  );
}

/** The page name in a small dark bubble beside the icon, on hover and keyboard focus. */
function RailItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="group relative">
      {children}
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-full z-40 ml-3 -translate-y-1/2 rounded-full bg-foreground px-3 py-1.5 text-sm whitespace-nowrap text-background opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
      >
        {label}
      </span>
    </div>
  );
}

export function PhoneTabBar({
  shopName,
  userLabel,
  onSignOut,
}: {
  shopName: string;
  userLabel: string;
  onSignOut: () => void;
}) {
  const isActive = useActive();
  const [moreOpen, setMoreOpen] = useState(false);
  const tabs = appNav.filter((n) => phoneTabs.includes(n.to));
  const rest = appNav.filter((n) => !phoneTabs.includes(n.to));
  const moreActive = rest.some((n) => isActive(n.to));

  const tabClass = (active: boolean) =>
    cn(
      "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[0.8125rem] font-medium",
      active ? "text-primary" : "text-muted-foreground",
    );

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-3 bottom-3 z-30 flex items-stretch gap-1 rounded-full bg-card p-1.5 shadow-[0_2px_16px_rgba(0,0,0,0.08)] md:hidden print:hidden"
      >
        {tabs.map(({ to, label, icon: Icon }) => {
          const active = isActive(to);
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? "page" : undefined}
              className={tabClass(active)}
            >
              <Icon aria-hidden className="size-6" />
              {label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={cn(tabClass(moreActive), "cursor-pointer")}
          aria-haspopup="dialog"
        >
          <MoreHorizontal aria-hidden className="size-6" />
          More
        </button>
      </nav>
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-[1.75rem]">
          <SheetHeader>
            <SheetTitle>{shopName}</SheetTitle>
            <SheetDescription>{userLabel}</SheetDescription>
          </SheetHeader>
          <ul className="flex flex-col gap-1 px-4 pb-6">
            {rest.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <Link
                  to={to}
                  onClick={() => setMoreOpen(false)}
                  aria-current={isActive(to) ? "page" : undefined}
                  className="flex min-h-12 items-center gap-3 rounded-2xl px-3 text-lg hover:bg-background aria-[current=page]:text-primary"
                >
                  <Icon aria-hidden className="size-6" />
                  {label}
                </Link>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={onSignOut}
                className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-lg hover:bg-background"
              >
                <LogOut aria-hidden className="size-6" />
                Sign out
              </button>
            </li>
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
