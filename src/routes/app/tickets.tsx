import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/app/EmptyState";

export const Route = createFileRoute("/app/tickets")({
  head: () => ({ meta: [{ title: "Tickets · Mend" }] }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="Tickets" />
      <EmptyState eyebrow="Coming next" title="No tickets yet">
        A searchable list of every job, open and closed, for when you prefer a table to the board.
      </EmptyState>
    </>
  );
}
