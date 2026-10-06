import { Link } from "@tanstack/react-router";

// Footer copy from the brand doc. The doc's support line "(800) 555-MEND" is
// left out until a real number exists (555 numbers are fictional).
export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-muted-foreground md:flex-row md:items-center md:justify-between md:px-8">
        <p>© 2026 Mend Inc. Built for independent repair shops.</p>
        <nav aria-label="Legal" className="flex gap-6">
          <Link to="/privacy" className="underline-offset-4 hover:text-foreground hover:underline">
            Privacy Policy
          </Link>
          <Link to="/terms" className="underline-offset-4 hover:text-foreground hover:underline">
            Terms of Service
          </Link>
        </nav>
      </div>
    </footer>
  );
}
