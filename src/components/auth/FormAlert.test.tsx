import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FormAlert } from "@/components/auth/AuthLayout";

// jsdom has no layout: place the alert above or inside the 800 px viewport by
// hand, and record scrollIntoView calls (jsdom doesn't implement it).
let top = -300;
const scrollIntoView = vi.fn();

beforeEach(() => {
  top = -300;
  scrollIntoView.mockClear();
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  Element.prototype.scrollIntoView = scrollIntoView;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ top, bottom: top + 60 }) as DOMRect,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("FormAlert scrolls an off-screen error into view", () => {
  it("scrolls when an error appears above the visible part of the page", () => {
    render(<FormAlert tone="error">Add your shop's address and phone.</FormAlert>);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
  });

  it("leaves the page alone when the error is already visible", () => {
    top = 200;
    render(<FormAlert tone="error">Visible error</FormAlert>);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("doesn't scroll again on a re-render with the same text, but does for a new text", () => {
    const { rerender } = render(<FormAlert tone="error">First</FormAlert>);
    rerender(<FormAlert tone="error">First</FormAlert>);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    rerender(<FormAlert tone="error">Second</FormAlert>);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("scrolls again when remounted with the same text (setup's retry key)", () => {
    const { rerender } = render(
      <FormAlert key={1} tone="error">
        Same
      </FormAlert>,
    );
    rerender(
      <FormAlert key={2} tone="error">
        Same
      </FormAlert>,
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("never scrolls for an info message", () => {
    render(<FormAlert tone="info">Saved.</FormAlert>);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("jumps without animation when reduced motion is preferred", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) => ({ matches: query.includes("reduce"), media: query }) as MediaQueryList,
    );
    render(<FormAlert tone="error">Error</FormAlert>);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
  });
});
