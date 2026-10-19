import { useCallback, useEffect, useRef, useState } from "react";

// Board drag done by Mend instead of the browser (19 Oct round 2, item 9;
// decision 111). The browser's own drag image showed only the card's link in
// Chrome on the Mac; here the card itself follows the pointer, the same in
// every browser. A press becomes a drag after the pointer moves a few pixels,
// so a plain click still opens the ticket.

export type DragState = {
  id: string;
  /** Pointer position, and where on the card it was grabbed. */
  x: number;
  y: number;
  dx: number;
  dy: number;
  width: number;
  /** The column under the pointer (its data-drop-id), if any. */
  over: string | null;
};

const START_AFTER_PX = 6;

export function usePointerDrag(onDrop: (id: string, target: string) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const press = useRef<{ id: string; x: number; y: number; rect: DOMRect } | null>(null);
  const dragged = useRef(false);
  const dropRef = useRef(onDrop);
  useEffect(() => {
    dropRef.current = onDrop;
  });

  const columnAt = (x: number, y: number) =>
    (
      document
        .elementsFromPoint(x, y)
        .find((el) => el instanceof HTMLElement && el.dataset["dropId"]) as HTMLElement | undefined
    )?.dataset["dropId"] ?? null;

  useEffect(() => {
    function move(e: PointerEvent) {
      const p = press.current;
      if (!p) return;
      setDrag((d) => {
        if (!d && Math.hypot(e.clientX - p.x, e.clientY - p.y) < START_AFTER_PX) return d;
        dragged.current = true;
        return {
          id: p.id,
          x: e.clientX,
          y: e.clientY,
          dx: p.x - p.rect.left,
          dy: p.y - p.rect.top,
          width: p.rect.width,
          over: columnAt(e.clientX, e.clientY),
        };
      });
    }
    function up(e: PointerEvent) {
      const p = press.current;
      press.current = null;
      setDrag((d) => {
        if (d && p) {
          const target = columnAt(e.clientX, e.clientY);
          if (target) queueMicrotask(() => dropRef.current(p.id, target));
        }
        return null;
      });
      document.body.style.userSelect = "";
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  /** Spread on each card: starts a possible drag, and swallows the click that ends one. */
  const cardProps = useCallback(
    (id: string) => ({
      onPointerDown(e: React.PointerEvent<HTMLElement>) {
        // Mouse and pen only: on touch screens the board scrolls; status
        // changes there go through the ticket page.
        if (e.button !== 0 || e.pointerType === "touch") return;
        if ((e.target as HTMLElement).closest("button")) return;
        press.current = {
          id,
          x: e.clientX,
          y: e.clientY,
          rect: e.currentTarget.getBoundingClientRect(),
        };
        dragged.current = false;
        document.body.style.userSelect = "none";
      },
      onClickCapture(e: React.MouseEvent) {
        if (dragged.current) {
          e.preventDefault();
          e.stopPropagation();
          dragged.current = false;
        }
      },
      // No browser drag at all (links and images are draggable by default).
      onDragStart(e: React.DragEvent) {
        e.preventDefault();
      },
    }),
    [],
  );

  return { drag, cardProps };
}
