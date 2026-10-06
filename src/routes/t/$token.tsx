import { createFileRoute, notFound } from "@tanstack/react-router";

// Reserved for future customer status pages (spec §3, §10). Do not reuse this
// path for anything else. Until it's built, every token is "not found".
export const Route = createFileRoute("/t/$token")({
  beforeLoad: () => {
    throw notFound();
  },
});
