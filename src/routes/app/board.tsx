import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/app/EmptyState";

export const Route = createFileRoute("/app/board")({
  head: () => ({ meta: [{ title: "Board · Mend" }] }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="Board" />
      <EmptyState eyebrow="Coming next" title="Your repair jobs will live here">
        Every ticket shows up as a card in a column, from Received to Picked up. Ticket intake is
        the next part we build.
      </EmptyState>
    </>
  );
}
