import { createFileRoute } from "@tanstack/react-router";

// Reserved for invite acceptance (spec §5), built in Phase 1B. The token is
// never trusted client-side: a server-side function will verify it.
export const Route = createFileRoute("/invite/$token")({
  head: () => ({ meta: [{ title: "Invitation · Mend" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <main className="mx-auto max-w-md px-4 py-24">
      <h1 className="text-2xl font-semibold">Invitations are almost ready</h1>
      <p className="mt-3 text-muted-foreground">
        Joining a shop from an invite link isn't available yet. Please check back soon.
      </p>
    </main>
  ),
});
