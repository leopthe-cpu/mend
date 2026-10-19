import { Link, useCanGoBack, useRouter } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

// Round black "‹" on detail pages (19 Oct feedback, item 14). It goes back to
// where you came from (calendar, customer page, search…); opened straight from
// a link or a new tab there is no in-app history, so it falls back to `to`.
export function BackButton({
  to,
  label,
}: {
  to: "/app/tickets" | "/app/customers";
  label: string;
}) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  return (
    <Link
      to={to}
      aria-label={label}
      title={label}
      onClick={(e) => {
        if (!canGoBack || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        router.history.back();
      }}
      className="flex size-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none print:hidden"
    >
      <ChevronLeft className="size-5" aria-hidden />
    </Link>
  );
}
