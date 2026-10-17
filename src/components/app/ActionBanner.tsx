import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

// In-app banners for things the owner should do (decision 81): the whole
// banner is the button, on a soft orange or green wash with film grain (Oz's
// reference, 16 Oct). This is the one place the app uses a gradient and grain
// (CLAUDE.md design rules otherwise keep the app flat). Text stays near-black
// on light colours so it passes AA.

const WASH: Record<"orange" | "green", string> = {
  orange: "radial-gradient(120% 140% at 0% 0%, #FFB37A 0%, #FFD8BC 45%, #FBF3EA 100%)",
  green: "radial-gradient(120% 140% at 0% 0%, #8FD4A8 0%, #CBEBD6 45%, #F1F8F2 100%)",
};

const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

/**
 * `children` is the clickable control (a Link or button) holding the title. It
 * stretches over the whole banner (after:absolute); `extra` sits above it, so
 * links inside it stay clickable on their own.
 */
export function ActionBanner({
  tone,
  children,
  text,
  extra,
}: {
  tone: "orange" | "green";
  children: ReactNode;
  text?: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div
      className="relative mb-6 overflow-hidden rounded-lg border border-black/10 text-[#1A1A1A] transition-shadow focus-within:ring-2 focus-within:ring-ring hover:shadow-sm"
      style={{ backgroundImage: WASH[tone] }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.18] mix-blend-multiply"
        style={{ backgroundImage: GRAIN }}
      />
      <div className="relative flex items-center gap-4 p-4">
        <div className="min-w-0 flex-1">
          {children}
          {text ? <p className="text-sm text-[#3A3A3A]">{text}</p> : null}
          {extra ? <div className="relative z-10 mt-1 text-sm text-[#3A3A3A]">{extra}</div> : null}
        </div>
        <ArrowRight aria-hidden className="size-5 shrink-0" />
      </div>
    </div>
  );
}
