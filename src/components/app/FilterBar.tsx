import { Search, X } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

// One search-and-filter bar per list page (19 Oct feedback, items 12 and 13;
// decision 103). Typing filters the rows by text and suggests that page's
// filters (status, people, flags…); picked filters show as chips in the bar.
// Filters in the same group widen the list (Received or Ready), filters in
// different groups narrow it (Ready and assigned to Ana).

export type FilterOption = {
  /** Stable id, e.g. "status:<uuid>" or "flag:overdue". */
  id: string;
  /** Group heading in the suggestions, e.g. "Status". */
  group: string;
  label: string;
  /** Optional colour class for the chip's dot (status colours). */
  dotClass?: string;
};

export function FilterBar({
  options,
  active,
  onToggle,
  text,
  onText,
  placeholder,
  children,
}: {
  options: FilterOption[];
  active: string[];
  onToggle: (id: string) => void;
  text: string;
  onText: (text: string) => void;
  placeholder: string;
  /** Extra controls after the bar (e.g. the date range). */
  children?: ReactNode;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const q = text.trim().toLowerCase();
  const suggestions = useMemo(
    () =>
      options
        .filter((o) => !active.includes(o.id))
        .filter(
          (o) => !q || o.label.toLowerCase().includes(q) || o.group.toLowerCase().startsWith(q),
        )
        .slice(0, 12),
    [options, active, q],
  );

  function pick(o: FilterOption) {
    onToggle(o.id);
    onText("");
    setCursor(0);
  }

  let lastGroup = "";
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 basis-80">
        <div className="flex min-h-12 flex-wrap items-center gap-1.5 rounded-lg bg-card py-1.5 pr-2 pl-3 focus-within:ring-2 focus-within:ring-ring">
          <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          {active.map((id) => {
            const o = byId.get(id);
            if (!o) return null;
            return (
              <span
                key={id}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-background pr-1 pl-2.5 text-sm font-medium"
              >
                {o.dotClass ? (
                  <span aria-hidden className={cn("size-2 rounded-full", o.dotClass)} />
                ) : null}
                <span className="text-muted-foreground">{o.group}:</span> {o.label}
                <button
                  type="button"
                  aria-label={`Remove filter ${o.group}: ${o.label}`}
                  onClick={() => onToggle(id)}
                  className="flex size-6 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-border/60 hover:text-foreground"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </span>
            );
          })}
          <input
            type="search"
            role="combobox"
            aria-expanded={open && suggestions.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label={placeholder}
            placeholder={active.length ? "Add a filter…" : placeholder}
            value={text}
            onChange={(e) => {
              onText(e.target.value);
              setOpen(true);
              setCursor(0);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
                setCursor((c) => Math.min(c + 1, suggestions.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter" && open && q && suggestions[cursor]) {
                // Enter picks a suggestion only while typing; otherwise the
                // text itself stays as the search.
                e.preventDefault();
                pick(suggestions[cursor]);
              } else if (e.key === "Escape") {
                setOpen(false);
              } else if (e.key === "Backspace" && !text && active.length) {
                onToggle(active[active.length - 1] ?? "");
              }
            }}
            className="h-9 min-w-32 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          {text || active.length ? (
            <button
              type="button"
              aria-label="Clear search and filters"
              onClick={() => {
                onText("");
                active.forEach(onToggle);
              }}
              className="flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
        {open && suggestions.length ? (
          <ul
            id={listId}
            role="listbox"
            className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-lg bg-card p-1.5 shadow-[0_4px_24px_rgba(0,0,0,0.12)]"
          >
            {suggestions.map((o, i) => {
              const heading = o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              return (
                <li key={o.id} role="presentation">
                  {heading ? (
                    <div className="px-2.5 pt-2 pb-1 text-sm text-muted-foreground">{heading}</div>
                  ) : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === cursor}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(o);
                    }}
                    onMouseEnter={() => setCursor(i)}
                    className={cn(
                      "flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-left",
                      i === cursor && "bg-background",
                    )}
                  >
                    {o.dotClass ? (
                      <span aria-hidden className={cn("size-2.5 rounded-full", o.dotClass)} />
                    ) : null}
                    {o.label}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/**
 * A table value that filters the list when clicked (item 12): coloured for
 * statuses, neutral for people. Pressed while its filter is on.
 */
export function ValueChip({
  label,
  dotClass,
  tintClass,
  pressed,
  onClick,
}: {
  label: string;
  dotClass?: string;
  /** Soft background in the value's colour (statuses); neutral when absent. */
  tintClass?: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={pressed ? `Remove filter: ${label}` : `Show only ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-sm font-medium whitespace-nowrap transition-colors",
        pressed
          ? "bg-foreground text-background"
          : cn("text-foreground hover:bg-border/60", tintClass ?? "bg-background"),
      )}
    >
      {dotClass ? <span aria-hidden className={cn("size-2 rounded-full", dotClass)} /> : null}
      {label}
    </button>
  );
}
