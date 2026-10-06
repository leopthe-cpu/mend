import { createFileRoute, Link } from "@tanstack/react-router";

import { Logo } from "@/components/brand/Logo";

// PLACEHOLDER (spec §4 "privacy policy page and terms page placeholders").
// The wording needs a human decision and legal review (PIPEDA, CCPA, CASL);
// do not treat this page as final. Twilio's toll-free verification needs this URL live.
export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms of service · Mend" }] }),
  component: Page,
});

function Page() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link to="/" aria-label="Mend home">
        <Logo height={32} className="-ml-1" />
      </Link>
      <h1 className="mt-8 text-3xl font-semibold">Terms of service</h1>
      <p className="mt-2 font-mono text-sm text-muted-foreground">Draft. Not yet in effect.</p>
      <p className="mt-6 text-muted-foreground">
        We're preparing our terms of service. They will describe how repair shops may use Mend,
        including the rules for sending messages to their customers.
      </p>
      <p className="mt-4 text-muted-foreground">Questions? Contact us and we'll get back to you.</p>
    </main>
  );
}
