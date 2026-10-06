import { Check, MessageSquare } from "lucide-react";

// Small, honest illustrations of Mend's real screens for "How it works"
// (stand-ins for the brand doc's photo concepts until real photography
// exists). Purely decorative: each step's text says the same thing.

export function TicketArt() {
  return (
    <div aria-hidden className="relative h-56 overflow-hidden rounded-2xl bg-[#E9E2D6] p-5">
      {/* Paper claim tag */}
      <div className="absolute top-6 left-6 w-36 -rotate-6 rounded-md border border-[#CDBFA8] bg-[#F3EBDD] p-3 shadow-sm">
        <div className="text-xs font-semibold tracking-wide text-[#6B5B45] uppercase">
          Claim tag
        </div>
        <div className="mt-1 font-mono text-2xl font-bold text-[#3A2F22]">№ 1042</div>
        <div className="mt-2 h-px bg-[#CDBFA8]" />
        <div className="mt-2 text-sm text-[#6B5B45]">Resole, brown boots</div>
      </div>
      {/* Phone with Mend's form */}
      <div className="absolute right-6 bottom-[-1.5rem] w-44 rounded-[1.5rem] border-4 border-[#1A1A1A] bg-background p-3 shadow-lg">
        <div className="text-sm font-semibold">New ticket</div>
        <div className="mt-2 rounded-md border border-input bg-white px-2 py-1.5 text-sm">
          Maria Rossi
        </div>
        <div className="mt-2 rounded-md border border-input bg-white px-2 py-1.5 font-mono text-sm">
          416 555 0100
        </div>
        <div className="mt-2 rounded-md border border-input bg-white px-2 py-1.5 text-sm">
          Brown boots
        </div>
        <div className="mt-3 rounded-md bg-black py-1.5 text-center text-sm font-medium text-white">
          Save
        </div>
      </div>
    </div>
  );
}

export function ReadyArt() {
  return (
    <div aria-hidden className="flex h-56 items-center justify-center rounded-2xl bg-[#E9E2D6] p-5">
      <div className="w-64 rounded-xl border border-border bg-background p-4 shadow-sm">
        <div className="font-mono text-sm text-muted-foreground">#1042</div>
        <div className="font-semibold">Brown boots · Maria R.</div>
        <div className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-black py-3 font-semibold text-white">
          <Check className="size-5" /> Ready for pickup
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <span className="size-2.5 rounded-full bg-brand" /> Moves to Ready
        </div>
      </div>
    </div>
  );
}

export function TextArt() {
  return (
    <div aria-hidden className="relative h-56 overflow-hidden rounded-2xl bg-[#E9E2D6]">
      <div className="absolute top-6 left-1/2 w-56 -translate-x-1/2 rounded-[1.75rem] border-4 border-[#1A1A1A] bg-white p-3 pb-10 shadow-lg">
        <div className="flex items-center gap-2 border-b border-border pb-2 text-sm font-semibold">
          <MessageSquare className="size-4" /> Your repair shop
        </div>
        <div className="mt-3 max-w-[85%] rounded-2xl rounded-bl-sm bg-[#EFEFE8] px-3 py-2 text-sm leading-snug">
          Hi Maria, your brown boots are ready for pickup. Open until 6 pm today.
        </div>
        <div className="mt-1 text-xs text-muted-foreground">Delivered</div>
      </div>
    </div>
  );
}
