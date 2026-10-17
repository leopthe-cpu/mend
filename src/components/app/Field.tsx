import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";

export function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** A button on the right of the title, e.g. "Edit". */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{title}</h2>
        {action}
      </div>
      {description ? <div className="mt-1 text-muted-foreground">{description}</div> : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export const selectClass =
  "h-11 w-full rounded-md border border-input bg-surface-2 px-3 text-base disabled:opacity-60";
