import { BookOpen, MessageSquare, Settings, SquareKanban, Ticket, Users } from "lucide-react";

// Left navigation (spec §3 "Suggested app structure", §8.4). Role-based hiding
// arrives with memberships in Phase 1B; the database enforces access anyway.
export const appNav = [
  { to: "/app/board", label: "Board", icon: SquareKanban },
  { to: "/app/tickets", label: "Tickets", icon: Ticket },
  { to: "/app/customers", label: "Customers", icon: Users },
  { to: "/app/catalog", label: "Catalog", icon: BookOpen },
  { to: "/app/messages", label: "Messages", icon: MessageSquare },
  { to: "/app/settings", label: "Settings", icon: Settings },
] as const;
