import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Logo } from "@/components/brand/Logo";

// Shared frame for login/signup/reset: form on the left, shop photography on
// the right on wide screens (spec §8.4 "photography in onboarding").
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-2">
      <main className="flex flex-col px-6 py-8 md:px-12">
        <Link to="/" aria-label="Mend home" className="self-start rounded-md">
          <Logo height={30} className="-ml-1" />
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="text-[1.75rem] font-semibold leading-tight">{title}</h1>
          {subtitle ? <div className="mt-2 text-muted-foreground">{subtitle}</div> : null}
          <div className="mt-8">{children}</div>
          {footer ? <div className="mt-8 text-muted-foreground">{footer}</div> : null}
        </div>
      </main>
      <div className="relative hidden lg:block" aria-hidden>
        <img
          src="/images/tailor-and-cleaners-winter.webp"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          width={2000}
          height={2000}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/20 to-transparent" />
      </div>
    </div>
  );
}

export function FormAlert({ tone, children }: { tone: "error" | "info"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "rounded-md border border-danger/60 bg-danger/10 px-4 py-3 text-danger"
          : "rounded-md border border-border bg-card px-4 py-3 text-foreground"
      }
    >
      {children}
    </div>
  );
}
