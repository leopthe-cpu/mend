import { Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { type Segment, type TokenOption } from "@/lib/messageTokens";
import { cn } from "@/lib/utils";

/**
 * A message box where ticket details sit inline as blue tokens (Oz, 29 Oct;
 * decision 146). A + follows the cursor: click it to insert a detail where
 * you're typing. In the column window the tokens are placeholders
 * ("{customer first name}"); in the send window they are the ticket's own
 * values ("Maria"), shown in blue so staff can see what came from the ticket.
 * Tokens behave like one character: Backspace removes the whole token.
 */

// Blue on the light grey: the "blue highlight text" pair (decision 91 contrast list).
const TOKEN_CLASS = "rounded bg-background px-0.5 font-medium text-brand-text";

function build(el: HTMLElement, segments: Segment[]) {
  el.replaceChildren(
    ...segments.map((s) => {
      if (!("field" in s)) return document.createTextNode(s.text);
      const span = document.createElement("span");
      span.contentEditable = "false";
      span.dataset["field"] = s.field;
      span.className = TOKEN_CLASS;
      span.textContent = s.text;
      return span;
    }),
  );
}

function read(el: HTMLElement): Segment[] {
  const out: Segment[] = [];
  const push = (text: string) => {
    if (!text) return;
    const prev = out[out.length - 1];
    if (prev && !("field" in prev)) prev.text += text;
    else out.push({ text });
  };
  const walk = (node: Node) => {
    node.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) push(n.textContent ?? "");
      else if (n instanceof HTMLElement && n.dataset["field"])
        out.push({ field: n.dataset["field"], text: n.textContent ?? "" });
      else if (n instanceof HTMLBRElement) push("\n");
      else if (n instanceof HTMLElement) {
        // Some browsers wrap new lines in <div>s.
        if (n.tagName === "DIV" && out.length) push("\n");
        walk(n);
      }
    });
  };
  walk(el);
  return out;
}

export function TokenEditor({
  id,
  labelId,
  value,
  resetKey,
  options,
  singleLine,
  disabled,
  rows = 4,
  onChange,
}: {
  id: string;
  /** The visible label's id (the box is a contenteditable, not a textarea). */
  labelId: string;
  /** Initial content; read again whenever resetKey changes. */
  value: Segment[];
  resetKey: string | number;
  options: TokenOption[];
  singleLine?: boolean;
  disabled?: boolean;
  rows?: number;
  onChange: (segments: Segment[]) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const range = useRef<Range | null>(null);
  const [plus, setPlus] = useState<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState(false);
  // The + hides 1.5 s after the pointer stops (and while typing) so it never
  // covers the words being edited; moving the pointer or tapping brings it
  // back (Oz, 29 Oct; decision 147).
  const [shown, setShown] = useState(false);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wake = useCallback(() => {
    setShown(true);
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => setShown(false), 1500);
  }, []);
  useEffect(
    () => () => {
      if (idle.current) clearTimeout(idle.current);
    },
    [],
  );

  // The DOM is the source of truth while typing; it is rebuilt only on reset.
  useLayoutEffect(() => {
    if (box.current) build(box.current, value);
    range.current = null;
    // value is read only when resetKey changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const emit = useCallback(() => {
    if (box.current) onChange(read(box.current));
  }, [onChange]);

  // Where the + goes: right after the end of the message, or right of the
  // cursor while editing inside it.
  const place = useCallback((rect: DOMRect | null) => {
    if (!wrap.current) return;
    const base = wrap.current.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0 && rect.left === 0)) {
      setPlus({ x: 12, y: 10 });
      return;
    }
    setPlus({ x: rect.right - base.left + 4, y: rect.top - base.top + rect.height / 2 - 12 });
  }, []);

  const atEnd = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const last = el.lastChild;
    if (!last) return place(null);
    if (last.nodeType === Node.TEXT_NODE && (last.textContent ?? "").length) {
      const r = document.createRange();
      r.setStart(last, last.textContent!.length);
      r.collapse(true);
      const rects = r.getClientRects();
      return place(rects[rects.length - 1] ?? null);
    }
    place(last instanceof HTMLElement ? last.getBoundingClientRect() : null);
  }, [place]);

  const track = useCallback(() => {
    const el = box.current;
    const sel = window.getSelection();
    if (!el || !sel?.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (!el.contains(r.startContainer)) return;
    range.current = r.cloneRange();
    const rects = r.getClientRects();
    place(rects[rects.length - 1] ?? r.getBoundingClientRect());
  }, [place]);

  // Before anyone clicks in, the + waits at the end of the message.
  useLayoutEffect(() => {
    atEnd();
  }, [atEnd, resetKey]);

  useEffect(() => {
    document.addEventListener("selectionchange", track);
    return () => document.removeEventListener("selectionchange", track);
  }, [track]);

  // Click away closes the menu.
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  function insert(o: TokenOption) {
    const el = box.current;
    if (!el) return;
    const span = document.createElement("span");
    span.contentEditable = "false";
    span.dataset["field"] = o.field;
    span.className = TOKEN_CLASS;
    span.textContent = o.value ?? `{${o.label.toLowerCase()}}`;
    const r = range.current && el.contains(range.current.startContainer) ? range.current : null;
    if (r) {
      r.deleteContents();
      r.insertNode(span);
    } else el.appendChild(span);
    // A space after the token, and the cursor after that.
    const space = document.createTextNode(" ");
    span.after(space);
    const after = document.createRange();
    after.setStart(space, 1);
    after.collapse(true);
    el.focus();
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(after);
    range.current = after.cloneRange();
    setMenu(false);
    emit();
    track();
  }

  const withValues = options.some((o) => o.value);
  return (
    <div ref={wrap} className="relative" onPointerMove={wake} onPointerEnter={wake}>
      <div
        ref={box}
        id={id}
        role="textbox"
        aria-multiline={!singleLine}
        aria-labelledby={labelId}
        aria-disabled={disabled || undefined}
        contentEditable={!disabled}
        suppressContentEditableWarning
        tabIndex={disabled ? -1 : 0}
        onInput={emit}
        onKeyDown={(e) => {
          if (e.key.length === 1 || e.key === "Backspace" || e.key === "Delete") setShown(false);
          if (e.key === "Enter" && singleLine) e.preventDefault();
          else if (e.key === "Enter") {
            e.preventDefault();
            document.execCommand("insertText", false, "\n");
          }
          if (e.key === "Escape") setMenu(false);
        }}
        onPaste={(e) => {
          // Plain text only.
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, singleLine ? text.replace(/\s+/g, " ") : text);
        }}
        onFocus={() => {
          track();
          wake();
        }}
        onBlur={() => {
          range.current = null;
          atEnd();
        }}
        onPointerUp={() => {
          track();
          wake();
        }}
        onKeyUp={track}
        style={singleLine ? undefined : { minHeight: `${rows * 1.6 + 1.5}rem` }}
        className={cn(
          "w-full rounded-lg border border-input bg-surface-2 py-2.5 pr-10 pl-3 text-base leading-relaxed break-words whitespace-pre-wrap focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          singleLine && "min-h-11 whitespace-nowrap overflow-x-auto",
          disabled && "cursor-not-allowed opacity-60",
        )}
      />
      {!disabled ? (
        <button
          type="button"
          aria-label="Insert a ticket detail"
          aria-haspopup="menu"
          aria-expanded={menu}
          title="Insert a ticket detail"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setMenu((m) => !m)}
          style={plus ? { left: plus.x, top: plus.y } : { left: 12, top: 10 }}
          className={cn(
            "absolute flex size-6 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 transition-opacity focus-visible:opacity-100 motion-reduce:transition-none",
            (shown || menu) && "opacity-100",
            !shown && !menu && "pointer-events-none",
          )}
        >
          <Plus aria-hidden className="size-4" />
        </button>
      ) : null}
      {menu ? (
        <div
          role="menu"
          aria-label="Ticket details"
          className={cn(
            "absolute z-20 mt-1 grid max-h-60 grid-cols-1 overflow-y-auto rounded-lg border border-border bg-card p-1 text-sm shadow-[0_6px_20px_rgba(0,0,0,0.1)]",
            withValues ? "w-60" : "w-48",
          )}
          // Kept inside the box's width, so the window never scrolls sideways.
          style={{
            left: Math.max(
              0,
              Math.min(
                (plus?.x ?? 12) - 8,
                (wrap.current?.clientWidth ?? 0) - (withValues ? 240 : 192),
              ),
            ),
            top: (plus?.y ?? 10) + 28,
          }}
        >
          {options.map((o) => (
            <button
              key={o.field}
              type="button"
              role="menuitem"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(o)}
              // Compact with a mouse, 44 px on touch screens (design rules).
              className="flex min-h-9 cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 text-left hover:bg-background focus-visible:bg-background focus-visible:outline-none pointer-coarse:min-h-11"
            >
              <span>{o.label}</span>
              {o.value ? (
                <span className="max-w-24 truncate text-muted-foreground">{o.value}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
