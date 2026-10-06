import { cn } from "@/lib/utils";

// The uploaded wordmark is the source of truth (spec §8.1). Never stretch or
// recolor it; the padding keeps the required clear space (≥ the period's
// height, about 12% of the image height) around it.
const WORDMARK = { src: "/brand/mend-wordmark.png", width: 456, height: 176 };

export function Logo({ height = 28, className }: { height?: number; className?: string }) {
  const width = Math.round((WORDMARK.width / WORDMARK.height) * height);
  return (
    <span className={cn("inline-block", className)} style={{ padding: height * 0.12 }}>
      <img
        src={WORDMARK.src}
        width={width}
        height={height}
        alt="mend."
        className="block h-auto max-w-none select-none"
        style={{ width, height }}
        draggable={false}
      />
    </span>
  );
}
