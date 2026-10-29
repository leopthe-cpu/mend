import type { SVGProps } from "react";

// The board card's message icons (decision 142). Shapes differ by state so
// colour is never the only signal: upside down (not sent), flying (sent),
// crashed (failed). The plane is Lucide's "send" icon (ISC licence), drawn in
// the same 24px grid and 2px stroke as the other icons.

const PLANE =
  "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z";
const FOLD = "m21.854 2.147-10.94 10.939";

function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

/** Yellow: this column's message hasn't gone out yet. */
export function PlaneDown(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <g transform="translate(0 24) scale(1 -1)">
        <path d={PLANE} />
        <path d={FOLD} />
      </g>
    </Icon>
  );
}

/** Green: sent. */
export function PlaneFlying(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <g transform="translate(5 0) scale(.8)">
        <path d={PLANE} />
        <path d={FOLD} />
      </g>
      <path d="M2 15.5h3" />
      <path d="M3 19.5l3-2" />
      <path d="M6.5 22l1.5-2" />
    </Icon>
  );
}

/** Red: the message failed. */
export function PlaneCrashed(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M2 22h20" />
      <path d="M3 5l13.5 12.5L7 15.5z" />
      <path d="M7 15.5l3-1.2" />
      <path d="M16.5 17.5l1.6-.4.2 1.8 1.7-.3" />
      <path d="M19.5 13.5l1.5-1.5" />
      <path d="M21 17.5h1.5" />
    </Icon>
  );
}
