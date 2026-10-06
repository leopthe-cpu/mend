import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/app/EmptyState";

export const Route = createFileRoute("/app/settings")({
  head: () => ({ meta: [{ title: "Settings · Mend" }] }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="Settings" />
      <EmptyState eyebrow="Coming soon" title="Shop settings">
        Your shop profile, team, statuses, message templates and taxes.
      </EmptyState>
    </>
  );
}
