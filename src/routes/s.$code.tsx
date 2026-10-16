import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Logo } from "@/components/brand/Logo";
import { getSupabase } from "@/lib/supabase";

// Public shop contact page (decision 76). Linked from the first text a
// customer gets, it identifies the sender as CASL requires: name, mailing
// address and a phone number. It needs no sign-in and shows only what
// public.shop_contact returns.
export const Route = createFileRoute("/s/$code")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Shop contact · Mend" }, { name: "robots", content: "noindex" }],
  }),
  component: ShopContact,
});

type Contact = {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  hours: string | null;
};

function ShopContact() {
  const { code } = Route.useParams();
  const [contact, setContact] = useState<Contact | null | undefined>(undefined);

  useEffect(() => {
    let stale = false;
    void getSupabase()
      .rpc("shop_contact", { p_code: code })
      .then(({ data }) => {
        if (stale) return;
        setContact(((data ?? []) as Contact[])[0] ?? null);
      });
    return () => {
      stale = true;
    };
  }, [code]);

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <main className="mx-auto w-full max-w-md flex-1 px-6 py-16">
        {contact === undefined ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : contact === null ? (
          <>
            <h1 className="text-2xl font-semibold">Shop not found</h1>
            <p className="mt-2 text-muted-foreground">Check the link in your text message.</p>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-semibold">{contact.name}</h1>
            <dl className="mt-6 flex flex-col gap-4">
              {contact.address ? (
                <div>
                  <dt className="text-sm text-muted-foreground">Address</dt>
                  <dd className="whitespace-pre-wrap">{contact.address}</dd>
                </div>
              ) : null}
              {contact.phone ? (
                <div>
                  <dt className="text-sm text-muted-foreground">Phone</dt>
                  <dd>
                    <a href={`tel:${contact.phone}`} className="underline underline-offset-4">
                      {contact.phone}
                    </a>
                  </dd>
                </div>
              ) : null}
              {contact.email ? (
                <div>
                  <dt className="text-sm text-muted-foreground">Email</dt>
                  <dd>
                    <a href={`mailto:${contact.email}`} className="underline underline-offset-4">
                      {contact.email}
                    </a>
                  </dd>
                </div>
              ) : null}
              {contact.hours ? (
                <div>
                  <dt className="text-sm text-muted-foreground">Hours</dt>
                  <dd>{contact.hours}</dd>
                </div>
              ) : null}
            </dl>
            <p className="mt-8 text-sm text-muted-foreground">
              {contact.name} sends repair updates by text through Mend. Reply STOP to any text to
              opt out, or contact the shop. See Mend's{" "}
              <Link to="/privacy" className="underline underline-offset-4">
                privacy policy
              </Link>
              .
            </p>
          </>
        )}
      </main>
      <footer className="mx-auto w-full max-w-md px-6 pb-10">
        <Link to="/" aria-label="Mend home">
          <Logo height={28} />
        </Link>
      </footer>
    </div>
  );
}
