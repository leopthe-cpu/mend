import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Logo } from "@/components/brand/Logo";
import { SiteFooter } from "@/components/site/SiteFooter";
import { LEGAL } from "@/lib/legal";

// Shared layout for /privacy and /terms. Public pages: they must load without
// signing in (Twilio toll-free verification checks the URLs, error 30519).

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
        <Link to="/" aria-label="Mend home">
          <Logo height={44} />
        </Link>
        <h1 className="mt-8 text-3xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Effective {LEGAL.effectiveDate}. Interim version, under legal review.
        </p>
        <div className="mt-8 flex flex-col gap-4 leading-relaxed [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1 [&_a]:underline [&_a]:underline-offset-4">
          {children}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

/** Contact lines; says plainly when a detail isn't published yet. */
export function LegalContact() {
  return (
    <ul>
      <li>
        {LEGAL.operator}, operating as {LEGAL.tradeName}, {LEGAL.province}, Canada
      </li>
      <li>Privacy officer: {LEGAL.privacyOfficer}</li>
      <li>
        Email:{" "}
        {LEGAL.contactEmail ? (
          <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>
        ) : (
          "to be published before launch"
        )}
      </li>
      <li>Mailing address: {LEGAL.mailingAddress ?? "to be published before launch"}</li>
    </ul>
  );
}
