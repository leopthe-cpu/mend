import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/app/EmptyState";

export const Route = createFileRoute("/app/customers")({
  head: () => ({ meta: [{ title: "Customers · Mend" }] }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="Customers" />
      <EmptyState eyebrow="Coming next" title="No customers yet">
        Customers are added the first time you log a job for them.
      </EmptyState>
    </>
  );
}
