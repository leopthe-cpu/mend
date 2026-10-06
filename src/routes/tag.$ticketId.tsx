import { createFileRoute, redirect } from "@tanstack/react-router";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { fetchMyMembership, type Shop } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import { fetchTicket, type Ticket } from "@/lib/tickets";

// Printable claim tag (spec §7.11). Printed on white: black and grey only,
// never cyan (spec §8.3). The QR code holds the ticket's in-app URL, which
// needs a login, so it reveals nothing to anyone who scans it.
export const Route = createFileRoute("/tag/$ticketId")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { size?: "label" } =>
    s["size"] === "label" ? { size: "label" } : {},
  beforeLoad: async ({ location }) => {
    const { data } = await getSupabase().auth.getSession();
    if (!data.session) throw redirect({ to: "/login", search: { redirect: location.href } });
    const m = await fetchMyMembership(data.session.user.id);
    if (!m) throw redirect({ to: "/onboarding" });
    return { shop: m.shop };
  },
  head: () => ({ meta: [{ title: "Claim tag · Mend" }] }),
  component: ClaimTag,
});

function ClaimTag() {
  const { ticketId } = Route.useParams();
  const { size } = Route.useSearch();
  const { shop } = Route.useRouteContext() as { shop: Shop };
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [qr, setQr] = useState("");

  useEffect(() => {
    void fetchTicket(ticketId).then(setTicket);
    void QRCode.toDataURL(`${window.location.origin}/app/tickets/${ticketId}`, {
      margin: 1,
      width: 240,
    }).then(setQr);
  }, [ticketId]);

  if (!ticket) return <p className="p-8">Loading…</p>;
  const label = size === "label";
  const stub = (
    <div className="flex flex-col gap-1">
      <p className="text-lg font-semibold">{shop.name}</p>
      <p className="font-mono text-3xl font-bold">#{ticket.ticket_number}</p>
      <p>{ticket.item_name}</p>
      {ticket.promised_date ? <p>Ready by {ticket.promised_date}</p> : null}
      {shop.phone ? <p>{shop.phone}</p> : null}
    </div>
  );

  return (
    <div className="min-h-svh bg-white text-black">
      <style>{`@media print { @page { size: ${label ? "2.25in 1.25in" : "letter"}; margin: ${label ? "0.05in" : "0.5in"}; } .no-print { display: none !important; } }`}</style>
      <div className="no-print flex flex-wrap items-center gap-3 border-b border-neutral-300 p-4">
        <Button onClick={() => window.print()} className="bg-black text-white hover:bg-neutral-800">
          Print
        </Button>
        <a className="underline" href={label ? `/tag/${ticketId}` : `/tag/${ticketId}?size=label`}>
          {label ? "Letter page" : "Small label (2.25 × 1.25 in)"}
        </a>
      </div>
      {label ? (
        <div className="flex h-[1.15in] w-[2.15in] items-center gap-2 overflow-hidden p-1 text-[9pt] leading-tight">
          {qr ? <img src={qr} alt="" className="size-[0.95in]" /> : null}
          <div className="min-w-0">
            <p className="font-mono text-[14pt] font-bold">#{ticket.ticket_number}</p>
            <p className="truncate">{ticket.customer?.name}</p>
            <p className="truncate">{ticket.item_name}</p>
          </div>
        </div>
      ) : (
        <div className="mx-auto flex max-w-[7.5in] flex-col gap-6 p-8">
          <section className="flex justify-between gap-6 rounded border-2 border-dashed border-neutral-500 p-6">
            <div>
              <p className="text-sm uppercase text-neutral-600">Customer stub · keep this</p>
              {stub}
            </div>
            {qr ? <img src={qr} alt="QR code for this ticket" className="size-32" /> : null}
          </section>
          <p className="text-center text-sm text-neutral-600">✂ cut here</p>
          <section className="flex justify-between gap-6 rounded border-2 border-neutral-800 p-6">
            <div>
              <p className="text-sm uppercase text-neutral-600">Item tag · attach to the item</p>
              <p className="font-mono text-3xl font-bold">#{ticket.ticket_number}</p>
              <p className="text-lg">{ticket.customer?.name}</p>
              <p>{ticket.item_name}</p>
            </div>
            {qr ? <img src={qr} alt="" className="size-32" /> : null}
          </section>
          <p className="text-center font-mono text-xs text-neutral-500">mend.</p>
        </div>
      )}
    </div>
  );
}
