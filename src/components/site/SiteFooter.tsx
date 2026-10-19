import { Link } from "@tanstack/react-router";

import { LEGAL } from "@/lib/legal";

// Footer copy from the brand doc. The doc's support line "(800) 555-MEND" is
// left out until a real number exists (555 numbers are fictional). The doc's
// "Mend Inc." is not a real company yet (decision 73); show the operator.
export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-muted-foreground md:flex-row md:items-center md:justify-between md:px-8">
        <div className="flex flex-col gap-1">
          <p>
            © 2026 {LEGAL.operator}, operating as {LEGAL.tradeName}. Built for independent repair
            shops.
          </p>
          {/* Contact on every public page: Twilio's toll-free review looks for it. */}
          {LEGAL.contactEmail || LEGAL.mailingAddress ? (
            <p>
              {LEGAL.contactEmail ? (
                <a
                  href={`mailto:${LEGAL.contactEmail}`}
                  className="underline-offset-4 hover:text-foreground hover:underline"
                >
                  {LEGAL.contactEmail}
                </a>
              ) : null}
              {LEGAL.contactEmail && LEGAL.mailingAddress ? " · " : null}
              {LEGAL.mailingAddress}
            </p>
          ) : null}
        </div>
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
