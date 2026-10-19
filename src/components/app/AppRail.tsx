import { Link, useRouterState } from "@tanstack/react-router";
import { LogOut, MoreHorizontal, Settings } from "lucide-react";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { appNav, phoneTabs, railNav } from "./nav";

// App navigation, Apple-style (decision 92, mockup approved 18 Oct): a
// floating rail of round icon buttons on tablets and computers (logo = Board,
// pages centred, profile menu at the foot: 19 Oct feedback), a bottom tab
// bar on phones with the rest of the pages under "More". Every icon has an
// accessible name; on the rail the name also shows on hover and focus.

function useActive() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (to: string) => pathname === to || pathname.startsWith(`${to}/`);
}

export function AppRail({
  userLabel,
  role,
  onSignOut,
}: {
  userLabel: string;
  role: string;
  onSignOut: () => void;
}) {
  const isActive = useActive();
  const onBoard = isActive("/app/board");
  return (
    <nav
      aria-label="Main"
      className="fixed top-4 bottom-4 left-4 z-30 hidden w-[4.5rem] flex-col items-center rounded-[2.25rem] bg-card py-3 md:flex print:hidden"
    >
      {/* The logo is the way to the Board (19 Oct feedback, item 3). Later a
          shop's own logo can go here (Pro, once pricing tiers exist). */}
      <RailItem label="Board">
        <Link
          to="/app/board"
          aria-label="Board"
          aria-current={onBoard ? "page" : undefined}
          className={cn(
            "flex size-14 items-center justify-center rounded-full bg-foreground text-xl font-bold tracking-tight text-background",
            onBoard && "ring-2 ring-primary ring-offset-2 ring-offset-card",
          )}
        >
          m<span className="text-[#64B5FF]">.</span>
        </Link>
      </RailItem>
      {/* Page icons centred in the free space between logo and profile. */}
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        {railNav.map(({ to, label, icon: Icon }) => {
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
      </div>
      <ProfileMenu
        userLabel={userLabel}
        role={role}
        settingsActive={isActive("/app/settings")}
        onSignOut={onSignOut}
      />
    </nav>
  );
}

/** Initials button at the foot of the rail; opens name, role, Settings and Sign out (item 16). */
function ProfileMenu({
  userLabel,
  role,
  settingsActive,
  onSignOut,
}: {
  userLabel: string;
  role: string;
  settingsActive: boolean;
  onSignOut: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account: ${userLabel}`}
        className={cn(
          "flex size-14 cursor-pointer items-center justify-center rounded-full text-base font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          settingsActive
            ? "bg-primary text-primary-foreground"
            : "bg-border text-foreground hover:bg-border/70",
        )}
      >
        {initials(userLabel)}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="end"
        sideOffset={12}
        className="w-60 rounded-lg border-0 p-1.5 shadow-[0_4px_24px_rgba(0,0,0,0.12)]"
      >
        <DropdownMenuLabel className="flex flex-col px-2.5 py-2 font-normal">
          <span className="truncate font-semibold">{userLabel}</span>
          <span className="text-sm text-muted-foreground capitalize">{role}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="min-h-11 cursor-pointer gap-3 px-2.5 text-base">
          <Link to="/app/settings">
            <Settings aria-hidden className="size-5" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={onSignOut}
          className="min-h-11 cursor-pointer gap-3 px-2.5 text-base"
        >
          <LogOut aria-hidden className="size-5" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "Oz Tester" → "OT"; an email → its first letter. */
function initials(label: string): string {
  const words = label.split(/[\s@.]+/).filter(Boolean);
  if (label.includes("@") || words.length < 2) return (words[0]?.[0] ?? "?").toUpperCase();
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase();
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
