// The text/background and UI/background pairs the product actually uses, with
// the WCAG 2.x AA minimum each must meet (spec §8.3): 4.5 for normal text,
// 3 for large text and for UI components (icons, input borders, focus rings).
// Values are CSS variable names from src/styles.css; the test resolves them
// to the hex source in each variable's comment.

export type ContrastPair = {
  fg: string;
  bg: string;
  min: 4.5 | 3;
  use: string;
};

const surfaces = ["--mend-bg", "--mend-surface-1", "--mend-surface-2"] as const;

const textOnAllSurfaces = (fg: string, use: string): ContrastPair[] =>
  surfaces.map((bg) => ({ fg, bg, min: 4.5, use }));
const uiOnAllSurfaces = (fg: string, use: string): ContrastPair[] =>
  surfaces.map((bg) => ({ fg, bg, min: 3, use }));

export const contrastPairs: ContrastPair[] = [
  ...textOnAllSurfaces("--mend-text", "Primary text"),
  ...textOnAllSurfaces("--mend-text-muted", "Secondary text, hints"),
  ...textOnAllSurfaces("--mend-accent", "Links, active nav label, Ready label"),
  { fg: "--mend-accent-foreground", bg: "--mend-accent", min: 4.5, use: "Text on cyan buttons" },
  { fg: "--mend-bg", bg: "--danger", min: 4.5, use: "Text on destructive buttons" },
  ...textOnAllSurfaces("--success", "Success message text"),
  ...textOnAllSurfaces("--warning", "Warning message text"),
  ...textOnAllSurfaces("--danger", "Error message text"),
  ...uiOnAllSurfaces("--mend-input-border", "Input and checkbox borders"),
  ...uiOnAllSurfaces("--mend-accent", "Focus ring"),
  ...uiOnAllSurfaces("--status-received", "Status icon: Received"),
  ...uiOnAllSurfaces("--status-in-progress", "Status icon: In progress"),
  ...uiOnAllSurfaces("--status-waiting", "Status icon: Waiting"),
  ...uiOnAllSurfaces("--status-ready", "Status icon: Ready"),
  ...uiOnAllSurfaces("--status-overdue", "Overdue badge"),
  ...uiOnAllSurfaces("--status-closed", "Status icon: Picked up / closed"),
];

/** Parses `--name: oklch(...); /* #RRGGBB` declarations from styles.css. */
export function parseTokenHexes(css: string): Map<string, { hex: string; oklch: string }> {
  const out = new Map<string, { hex: string; oklch: string }>();
  const re = /(--[a-z0-9-]+):\s*(oklch\([^)]*\));\s*\/\*\s*(#[0-9a-fA-F]{6})/g;
  for (const m of css.matchAll(re)) {
    const [, name, oklch, hex] = m;
    if (name && oklch && hex) out.set(name, { hex: hex.toUpperCase(), oklch });
  }
  return out;
}
