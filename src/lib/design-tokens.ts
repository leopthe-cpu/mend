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
const darkSurfaces = ["--dark-bg", "--dark-surface-1", "--dark-surface-2"] as const;

const textOn = (fg: string, use: string): ContrastPair[] =>
  surfaces.map((bg) => ({ fg, bg, min: 4.5, use }));
const uiOn = (fg: string, use: string): ContrastPair[] =>
  surfaces.map((bg) => ({ fg, bg, min: 3, use }));
const textOnDark = (fg: string, use: string): ContrastPair[] =>
  darkSurfaces.map((bg) => ({ fg, bg, min: 4.5, use: `${use} (charcoal)` }));
const uiOnDark = (fg: string, use: string): ContrastPair[] =>
  darkSurfaces.map((bg) => ({ fg, bg, min: 3, use: `${use} (charcoal)` }));

export const contrastPairs: ContrastPair[] = [
  // Cream canvas, bone panels, white inputs (brand guidelines, decision 50)
  ...textOn("--mend-text", "Primary text"),
  ...textOn("--mend-text-muted", "Secondary text, hints"),
  ...textOn("--mend-primary", "Links"),
  ...textOn("--mend-accent-text", "Terracotta text (labels, highlights)"),
  {
    fg: "--mend-primary-foreground",
    bg: "--mend-primary",
    min: 4.5,
    use: "Text on black buttons",
  },
  {
    fg: "--mend-accent-foreground",
    bg: "--mend-accent",
    min: 3,
    use: "Large text on terracotta badges",
  },
  { fg: "--mend-primary-foreground", bg: "--danger", min: 4.5, use: "Text on destructive buttons" },
  ...textOn("--success", "Success message text"),
  ...textOn("--warning", "Warning message text"),
  ...textOn("--danger", "Error message text"),
  ...uiOn("--mend-input-border", "Input and checkbox borders"),
  ...uiOn("--mend-primary", "Focus ring"),
  ...uiOn("--mend-accent", "Terracotta indicators and badges"),
  ...uiOn("--status-received", "Status icon: Received"),
  ...uiOn("--status-in-progress", "Status icon: In progress"),
  ...uiOn("--status-waiting", "Status icon: Waiting"),
  ...uiOn("--status-ready", "Status icon: Ready"),
  ...uiOn("--status-overdue", "Overdue badge"),
  ...uiOn("--status-closed", "Status icon: Picked up / closed"),

  // Charcoal navigation and dark sections
  ...textOnDark("--dark-text", "Primary text"),
  ...textOnDark("--dark-text-muted", "Secondary text"),
  ...textOnDark("--dark-accent", "Active nav label, links"),
  ...uiOnDark("--dark-input-border", "Input borders"),
  ...uiOnDark("--dark-accent", "Focus ring"),
  { fg: "--dark-bg", bg: "--dark-text", min: 4.5, use: "Text on cream buttons (charcoal)" },
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
