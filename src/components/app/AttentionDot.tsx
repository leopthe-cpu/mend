import { cn } from "@/lib/utils";

/**
 * A small red dot that marks where something needs the user's attention
 * (Oz, 23 Oct): the profile button, the Settings entry and the Settings tab.
 * Decorative; the element it sits on carries the words in its accessible name.
 */
export function AttentionDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block size-2.5 shrink-0 rounded-full bg-danger ring-2 ring-card", className)}
    />
  );
}
