import { createFileRoute, Link } from "@tanstack/react-router";

import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";

// Interim home page. The full editorial landing page is Phase 5 (spec §7.13);
// this keeps the brand look and gives signup/login an entry point.
export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <main className="relative min-h-svh overflow-hidden bg-background">
      <img
        src="/images/phone-repair-night.webp"
        alt="A phone repair shop lit up at night as a red and white streetcar blurs past"
        className="absolute inset-0 h-full w-full object-cover"
        width={2000}
        height={2000}
        fetchPriority="high"
      />
      {/* Dark overlay keeps the cyan tagline readable over any part of the photo */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/20"
      />
      <div className="relative mx-auto flex min-h-svh max-w-6xl flex-col justify-end px-6 pb-16 md:px-10 md:pb-24">
        <Logo height={56} className="-ml-2" />
        <h1 className="mt-2 max-w-xl text-4xl font-semibold leading-tight text-primary md:text-6xl">
          Keep your customers in the loop.
        </h1>
        <p className="mt-4 max-w-lg text-lg text-foreground">
          Track repair jobs, build estimates and tell customers their item is ready, in one tap.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/signup">Get started</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/login">Log in</Link>
          </Button>
        </div>
        <nav aria-label="Legal" className="mt-12 flex gap-6 text-sm text-muted-foreground">
          <Link to="/privacy" className="underline-offset-4 hover:underline">
            Privacy
          </Link>
          <Link to="/terms" className="underline-offset-4 hover:underline">
            Terms
          </Link>
        </nav>
      </div>
    </main>
  );
}
