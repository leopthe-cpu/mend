import { useNavigate } from "@tanstack/react-router";
import { Plus, Search, Ticket, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { NotificationCentre } from "@/components/app/NotificationCentre";
import { NewTicketDialog } from "@/components/tickets/NewTicketDialog";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { Membership } from "@/lib/shop";
import { onOpenNewTicket } from "@/lib/newTicket";
import { parseSearchDate } from "@/lib/searchDate";
import { getSupabase } from "@/lib/supabase";
import { shopToday } from "@/lib/tickets";
import { appNav } from "./nav";

type Hit = { kind: string; id: string; label: string; sublabel: string | null };

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    !!target.closest("[role=dialog]")
  );
}

export function TopBar({ membership }: { membership: Membership }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  // The query the shown results belong to; differs from the typed query
  // while a search is still on its way.
  const [doneFor, setDoneFor] = useState("");
  const seq = useRef(0);
  const navigate = useNavigate();

  // Ctrl/Cmd+K: search (spec §7.3). N: new ticket (decision P6), ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      } else if (
        e.key.toLowerCase() === "n" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !isTyping(e.target)
      ) {
        e.preventDefault();
        setNewOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => onOpenNewTicket(() => setNewOpen(true)), []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setDoneFor("");
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      // "Oct 20", "tomorrow"… are sent as YYYY-MM-DD (decision 102).
      const date = parseSearchDate(q, shopToday(membership.shop.time_zone));
      const { data } = await getSupabase().rpc("search_shop", {
        p_shop_id: membership.shop.id,
        p_query: date ?? q,
      });
      if (mine === seq.current) {
        setHits(
          ((data ?? []) as Hit[]).filter((h, i, all) => all.findIndex((x) => x.id === h.id) === i),
        );
        setDoneFor(q);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query, membership.shop.id, membership.shop.time_zone]);

  // "Go to" pages: all of them before typing, then only names that match, so
  // Enter on a search with no results doesn't open the first page (19 Oct
  // round 2, item 3).
  const q = query.trim();
  const pages = q
    ? appNav.filter(({ label }) => label.toLowerCase().startsWith(q.toLowerCase()))
    : appNav;
  const searching = q.length >= 2 && doneFor !== q;
  const nothing = q.length >= 2 && !searching && !hits.length;

  const go = (h: Hit) => {
    setSearchOpen(false);
    setQuery("");
    if (h.kind === "ticket")
      void navigate({ to: "/app/tickets/$ticketId", params: { ticketId: h.id } });
    else void navigate({ to: "/app/customers/$customerId", params: { customerId: h.id } });
  };

  return (
    // Sticky (19 Oct feedback, item 1): search and New ticket stay in reach on
    // long pages. The translucent canvas colour keeps content from showing
    // through as it scrolls under.
    <header className="sticky top-0 z-30 flex items-center gap-3 bg-background/90 px-4 py-4 backdrop-blur-md md:pr-6 md:pl-0 print:hidden">
      {/* Search bar (decision 92): black icon, then the hint. Same corner
          radius as banners and inputs (item 8); centred and wider on
          computers (item 15), with an equal spacer on the left so it sits in
          the middle of the bar. */}
      <div aria-hidden className="hidden flex-1 lg:block" />
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="flex h-12 min-w-0 flex-1 items-center gap-3 rounded-lg bg-card pr-4 pl-1.5 text-left text-muted-foreground transition-colors hover:text-foreground lg:max-w-2xl lg:flex-[2]"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
          <Search className="size-4" aria-hidden />
        </span>
        <span className="truncate">Search customers, items, dates, ticket #…</span>
        <kbd className="ml-auto hidden rounded-md border border-border px-2 font-mono text-sm whitespace-nowrap sm:inline">
          Ctrl K
        </kbd>
      </button>
      {/* Notification centre (decision 134): to-dos and team activity. */}
      <NotificationCentre membership={membership} />
      {/* The one filled button in the bar. The label shortens to "+" on
          phones, so the accessible name stays "New ticket" either way. */}
      <div className="flex justify-end lg:flex-1">
        <Button
          className="h-12"
          onClick={() => setNewOpen(true)}
          aria-keyshortcuts="N"
          aria-label="New ticket"
        >
          <Plus aria-hidden />
          <span className="hidden sm:inline" aria-hidden>
            New ticket
          </span>
        </Button>
      </div>

      <CommandDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        shouldFilter={false}
        title="Search"
        description="Search tickets and customers, or jump to a page"
      >
        <CommandInput
          placeholder="Name, item, date (Oct 20), ticket #, exact phone or email…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {q.length === 1 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Keep typing: at least 2 characters.
            </p>
          ) : null}
          {searching && !hits.length ? (
            <p role="status" className="px-4 py-6 text-center text-sm text-muted-foreground">
              Searching…
            </p>
          ) : null}
          {nothing ? (
            <div role="status" className="px-4 py-5 text-sm">
              <p className="font-semibold">Nothing matches &ldquo;{q}&rdquo;</p>
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
                <li>
                  Check the spelling, or type just the start of a name: &ldquo;Mar&rdquo; finds
                  Maria.
                </li>
                <li>For a ticket, type its number, like 1042.</li>
                <li>Phone numbers and emails need to be complete.</li>
                <li>
                  Dates work like &ldquo;Oct 20&rdquo;, &ldquo;20 Oct&rdquo; or
                  &ldquo;tomorrow&rdquo;.
                </li>
              </ul>
            </div>
          ) : null}
          {hits.length ? (
            <CommandGroup heading="Results">
              {hits.map((h) => (
                <CommandItem
                  key={h.kind + h.id}
                  value={`${h.kind}-${h.id}-${h.label}`}
                  onSelect={() => go(h)}
                >
                  {h.kind === "ticket" ? <Ticket aria-hidden /> : <User aria-hidden />}
                  <span>{h.label}</span>
                  {h.sublabel ? (
                    <span className="text-muted-foreground"> · {h.sublabel}</span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {pages.length ? (
            <CommandGroup heading="Go to">
              {pages.map(({ to, label, icon: Icon }) => (
                <CommandItem
                  key={to}
                  value={`go ${label}`}
                  onSelect={() => {
                    setSearchOpen(false);
                    void navigate({ to });
                  }}
                >
                  <Icon aria-hidden />
                  {label}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </CommandDialog>
      <NewTicketDialog open={newOpen} onOpenChange={setNewOpen} membership={membership} />
    </header>
  );
}
