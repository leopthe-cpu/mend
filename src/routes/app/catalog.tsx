import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/app/EmptyState";

export const Route = createFileRoute("/app/catalog")({
  head: () => ({ meta: [{ title: "Catalog · Mend" }] }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="Catalog" />
      <EmptyState eyebrow="Coming soon" title="Your price list">
        The shop owner sets up services and parts here, so estimates are quick and consistent.
      </EmptyState>
    </>
  );
}
