import { cn } from "@/lib/utils";

// Typographic wordmark in the brand font (brand guidelines, decision 50).
// The old PNG wordmark (white with cyan dots, public/brand/) was made for the
// dark navy theme and disappears on cream; it stays in the repo until Oz
// supplies a logo file for the new palette. Uses currentColor, so it works on
// cream and on charcoal.
export function Logo({ height = 28, className }: { height?: number; className?: string }) {
  return (
    <span
      className={cn("inline-block font-sans font-bold tracking-[-0.03em] select-none", className)}
      style={{ fontSize: height, lineHeight: 1 }}
    >
      Mend
    </span>
  );
}
