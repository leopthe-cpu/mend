import { createFileRoute, redirect } from "@tanstack/react-router";

// The calendar moved inside Tickets (decision 101); old links and bookmarks
// land on the new address with the same view and date.
export const Route = createFileRoute("/app/calendar")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/app/tickets/calendar", search, replace: true });
  },
});
