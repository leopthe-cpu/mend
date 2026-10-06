import { createFileRoute, Link } from "@tanstack/react-router";

import { Logo } from "@/components/brand/Logo";

// PLACEHOLDER (spec §4 "privacy policy page and terms page placeholders").
// The wording needs a human decision and legal review (PIPEDA, CCPA, CASL);
// do not treat this page as final. Twilio's toll-free verification needs this URL live.
export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy policy · Mend" }] }),
  component: Page,
});

function Page() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link to="/" aria-label="Mend home">
        <Logo height={32} className="-ml-1" />
      </Link>
      <h1 className="mt-8 text-3xl font-semibold">Privacy policy</h1>
      <p className="mt-2 font-mono text-sm text-muted-foreground">Draft. Not yet in effect.</p>
      <p className="mt-6 text-muted-foreground">
        We're preparing our privacy policy. It will explain what information Mend and the repair
        shops using it collect about customers and staff, why, how long it is kept, and how to ask
        for access, correction or deletion.
      </p>
      <p className="mt-4 text-muted-foreground">Questions? Contact us and we'll get back to you.</p>
    </main>
  );
}
