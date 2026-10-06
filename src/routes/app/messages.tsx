import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/app/EmptyState";

export const Route = createFileRoute("/app/messages")({
  head: () => ({ meta: [{ title: "Messages · Mend" }] }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="Messages" />
      <EmptyState eyebrow="Coming soon" title="No messages sent">
        Every text and email you send to a customer will be listed here with its delivery status.
      </EmptyState>
    </>
  );
}
