import { Link } from "@tanstack/react-router";
import { CalendarDays, List, SquareKanban } from "lucide-react";

import { cn } from "@/lib/utils";

// Tickets in three views (19 Oct feedback, item 4; decision 101): the Board
// (the home page's columns), the calendar by Ready-by date, and the list.
const VIEWS = [
  { to: "/app/board", label: "Board", icon: SquareKanban },
  { to: "/app/tickets/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/app/tickets", label: "List", icon: List },
] as const;

export function TicketViewSwitch({ current }: { current: (typeof VIEWS)[number]["to"] }) {
  return (
    <nav aria-label="Ticket views" className="flex rounded-full bg-card p-1">
      {VIEWS.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          aria-current={current === to ? "page" : undefined}
          className={cn(
            "flex h-10 items-center gap-2 rounded-full px-4 text-[0.9375rem] font-medium",
            current === to
              ? "bg-foreground text-background"
              : "text-foreground hover:bg-background",
          )}
        >
          <Icon aria-hidden className="size-4" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
