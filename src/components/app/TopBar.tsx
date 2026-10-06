import { useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";

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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNavigate } from "@tanstack/react-router";
import { appNav } from "./nav";

export function TopBar() {
  const [searchOpen, setSearchOpen] = useState(false);
  const navigate = useNavigate();

  // Ctrl/Cmd+K opens search (spec §7.3). The "N" shortcut for New ticket is
  // wired up with ticket intake in Phase 2 (decision P6).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background px-3 md:px-6">
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

      <Tooltip>
        <TooltipTrigger asChild>
          {/* span keeps the tooltip working on a disabled button */}
          <span tabIndex={0} className="ml-auto rounded-md">
            <Button disabled aria-keyshortcuts="N">
              <Plus aria-hidden />
              <span className="hidden sm:inline">New ticket</span>
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Ticket intake is coming next.</TooltipContent>
      </Tooltip>

      <CommandDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        title="Search"
        description="Search tickets and customers, or jump to a page"
      >
        <CommandInput placeholder="Search tickets, customers, phone…" />
        <CommandList>
          <CommandEmpty>
            No results yet. Ticket and customer search arrives with tickets.
          </CommandEmpty>
          <CommandGroup heading="Go to">
            {appNav.map(({ to, label, icon: Icon }) => (
              <CommandItem
                key={to}
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
    </header>
  );
}
