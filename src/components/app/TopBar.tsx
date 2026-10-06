import { useNavigate } from "@tanstack/react-router";
import { Plus, Search, Ticket, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { NewTicketDialog } from "@/components/tickets/NewTicketDialog";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { SidebarTrigger } from "@/components/ui/sidebar";
import type { Membership } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
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

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setHits([]);
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      const { data } = await getSupabase().rpc("search_shop", {
        p_shop_id: membership.shop.id,
        p_query: q,
      });
      if (mine === seq.current)
        setHits(
          ((data ?? []) as Hit[]).filter((h, i, all) => all.findIndex((x) => x.id === h.id) === i),
        );
    }, 200);
    return () => clearTimeout(timer);
  }, [query, membership.shop.id]);

  const go = (h: Hit) => {
    setSearchOpen(false);
    setQuery("");
    if (h.kind === "ticket")
      void navigate({ to: "/app/tickets/$ticketId", params: { ticketId: h.id } });
    else void navigate({ to: "/app/customers/$customerId", params: { customerId: h.id } });
  };

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background px-3 md:px-6 print:hidden">
      <SidebarTrigger className="size-11" aria-label="Toggle navigation" />
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-surface-2 px-3 text-left text-muted-foreground transition-colors hover:text-foreground md:max-w-md"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="truncate">Search tickets, customers, phone…</span>
        <kbd className="ml-auto hidden rounded border border-border px-1.5 font-mono text-sm sm:inline">
          Ctrl K
        </kbd>
      </button>
      <Button className="ml-auto" onClick={() => setNewOpen(true)} aria-keyshortcuts="N">
        <Plus aria-hidden />
        <span className="hidden sm:inline">New ticket</span>
      </Button>

      <CommandDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        shouldFilter={false}
        title="Search"
        description="Search tickets and customers, or jump to a page"
      >
        <CommandInput
          placeholder="Ticket #, name, exact phone or email…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>
            {query.trim().length < 2
              ? "Type at least 2 characters."
              : "Nothing found. Phone and email must match exactly."}
          </CommandEmpty>
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
          <CommandGroup heading="Go to">
            {appNav.map(({ to, label, icon: Icon }) => (
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
        </CommandList>
      </CommandDialog>
      <NewTicketDialog open={newOpen} onOpenChange={setNewOpen} membership={membership} />
    </header>
  );
}
