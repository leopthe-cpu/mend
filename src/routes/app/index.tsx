import { createFileRoute, redirect } from "@tanstack/react-router";

// Open the view this person used last: board or list (spec §7.3).
export const Route = createFileRoute("/app/")({
  beforeLoad: () => {
    let view = "board";
    try {
      view = localStorage.getItem("mend:ticketsView") ?? "board";
    } catch {
      /* storage unavailable */
    }
    throw redirect({ to: view === "list" ? "/app/tickets" : "/app/board" });
  },
});
