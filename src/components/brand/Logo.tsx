import { cn } from "@/lib/utils";

// The uploaded logo files are the source of truth (spec §8.1); never stretch
// or recolor them. Oz chose to keep them with the new palette (decision 55):
// - wordmark: white letters with cyan dots, made for dark backgrounds
//   (the charcoal sidebar);
// - badge: the same wordmark in a navy oval, which reads on any background
//   (cream pages, header).
const FILES = {
  wordmark: { src: "/brand/mend-wordmark.png", width: 456, height: 176 },
  badge: { src: "/brand/mend-badge.png", width: 608, height: 264 },
} as const;

export function Logo({
  height = 28,
  onDark = false,
  className,
}: {
  height?: number;
  /** Only on dark surfaces: use the bare wordmark instead of the badge. */
  onDark?: boolean;
  className?: string;
}) {
  const file = onDark ? FILES.wordmark : FILES.badge;
  const width = Math.round((file.width / file.height) * height);
  return (
    // The wordmark needs clear space around it (≥ the period's height, about
    // 12% of the image height); the badge's oval already provides it.
    <span className={cn("inline-block", className)} style={{ padding: onDark ? height * 0.12 : 0 }}>
      <img
        src={file.src}
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
