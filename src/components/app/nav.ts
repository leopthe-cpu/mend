import {
  BookOpen,
  CalendarDays,
  MessageSquare,
  Settings,
  SquareKanban,
  Ticket,
  Users,
} from "lucide-react";

// Left navigation (spec §3 "Suggested app structure", §8.4). Role-based hiding
// arrives with memberships in Phase 1B; the database enforces access anyway.
export const appNav = [
  { to: "/app/board", label: "Board", icon: SquareKanban },
  { to: "/app/tickets", label: "Tickets", icon: Ticket },
  { to: "/app/tickets/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/app/customers", label: "Customers", icon: Users },
  { to: "/app/catalog", label: "Catalog", icon: BookOpen },
  { to: "/app/messages", label: "Messages", icon: MessageSquare },
  { to: "/app/settings", label: "Settings", icon: Settings },
] as const;

// The rail's middle icons (19 Oct feedback, items 3, 4 and 16): the logo at
// the top opens the Board, the calendar is a view inside Tickets, Settings
// lives in the profile menu at the bottom.
export const railNav = appNav.filter(
  (n) => n.to !== "/app/board" && n.to !== "/app/settings" && n.to !== "/app/tickets/calendar",
);

// Pages that get their own tab on phones; the rest sit under "More" (decision 92).
export const phoneTabs: readonly string[] = [
  "/app/board",
  "/app/tickets",
  "/app/customers",
  "/app/messages",
];
