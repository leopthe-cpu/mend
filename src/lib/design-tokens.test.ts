import { readFileSync } from "node:fs";
import path from "node:path";
import { contrastRatio, formatOklch, hexToOklch } from "./color";
import { contrastPairs, parseTokenHexes } from "./design-tokens";

const css = readFileSync(path.resolve(__dirname, "../styles.css"), "utf8");
const tokens = parseTokenHexes(css);

describe("color math", () => {
  it("converts black and white to the OKLCH extremes", () => {
    expect(hexToOklch("#FFFFFF")[0]).toBeCloseTo(1, 3);
    expect(hexToOklch("#000000")[0]).toBeCloseTo(0, 3);
  });

  it("computes WCAG contrast (black on white is 21:1)", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
  });
});

describe("design tokens in styles.css", () => {
  it("declares the fixed brand colors exactly", () => {
    expect(tokens.get("--mend-bg")?.hex).toBe("#101025");
    expect(tokens.get("--mend-accent")?.hex).toBe("#1AFFF4");
  });

  it.each([...tokens.entries()])("%s oklch matches its source hex", (_name, { hex, oklch }) => {
    expect(oklch).toBe(formatOklch(hex));
  });

  it.each(contrastPairs)("$use: $fg on $bg meets $min:1", ({ fg, bg, min }) => {
    const fgHex = tokens.get(fg)?.hex;
    const bgHex = tokens.get(bg)?.hex;
    expect(fgHex, `${fg} not found in styles.css`).toBeDefined();
    expect(bgHex, `${bg} not found in styles.css`).toBeDefined();
    expect(contrastRatio(fgHex!, bgHex!)).toBeGreaterThanOrEqual(min);
  });
});
