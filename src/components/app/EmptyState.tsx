import type { ReactNode } from "react";

// Plain-language empty state (spec §8.4). Photography arrives with the
// landing page work; for now a calm text block keeps the shell honest.
export function EmptyState({
  title,
  children,
  eyebrow,
}: {
  title: string;
  children: ReactNode;
  eyebrow?: string;
}) {
  return (
    <section className="mx-auto flex max-w-xl flex-col items-start gap-3 rounded-lg border border-border bg-card p-8">
      {eyebrow ? (
        <p className="font-mono text-sm uppercase tracking-normal text-muted-foreground">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="text-muted-foreground">{children}</div>
    </section>
  );
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-[1.75rem] font-semibold leading-tight">{title}</h1>
      {children}
    </div>
  );
}
