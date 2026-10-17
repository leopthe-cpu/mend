import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { getSupabase } from "@/lib/supabase";

// Email unsubscribe page (decision 88), linked from the footer of every email
// Mend sends for a shop. It asks before stopping anything, because mail
// scanners open links. No sign-in: the random token in the link is the key,
// and it can only stop emails.
export const Route = createFileRoute("/unsubscribe")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    t: typeof search["t"] === "string" ? search["t"] : "",
  }),
  head: () => ({
    meta: [{ title: "Stop emails · Mend" }, { name: "robots", content: "noindex" }],
  }),
  component: Unsubscribe,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type State =
  | { kind: "loading" }
  | { kind: "unknown" }
  | { kind: "ask"; shop: string }
  | { kind: "done"; shop: string }
  | { kind: "error"; shop: string };

function Unsubscribe() {
  const { t } = Route.useSearch();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!UUID.test(t)) return setState({ kind: "unknown" });
    let stale = false;
    void getSupabase()
      .rpc("unsubscribe_preview", { p_token: t })
      .then(({ data }) => {
        if (stale) return;
        const row = ((data ?? []) as { shop_name: string; already_stopped: boolean }[])[0];
        if (!row) setState({ kind: "unknown" });
        else setState({ kind: row.already_stopped ? "done" : "ask", shop: row.shop_name });
      });
    return () => {
      stale = true;
    };
  }, [t]);

  async function stop(shop: string) {
    setSaving(true);
    const { data, error } = await getSupabase().rpc("email_unsubscribe", { p_token: t });
    setSaving(false);
    setState(error || !data ? { kind: "error", shop } : { kind: "done", shop });
  }

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <main className="mx-auto w-full max-w-md flex-1 px-6 py-16">
        {state.kind === "loading" ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : state.kind === "unknown" ? (
          <>
            <h1 className="text-2xl font-semibold">Link not recognized</h1>
            <p className="mt-2 text-muted-foreground">
              Use the link at the bottom of the email, or contact the shop directly.
            </p>
          </>
        ) : state.kind === "done" ? (
          <>
            <h1 className="text-2xl font-semibold">Emails stopped</h1>
            <p className="mt-2 text-muted-foreground">
              {state.shop} won't email you any more. To get emails again, ask the shop.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold">Stop emails from {state.shop}?</h1>
            <p className="mt-2 text-muted-foreground">
              You'll no longer get repair updates from {state.shop} by email. Texts, if you get
              them, aren't affected: reply STOP to a text to stop those.
            </p>
            {state.kind === "error" ? (
              <p role="alert" className="mt-4 text-destructive">
                That didn't work. Try again.
              </p>
            ) : null}
            <Button className="mt-6" disabled={saving} onClick={() => void stop(state.shop)}>
              {saving ? "Stopping…" : "Stop emails"}
            </Button>
          </>
        )}
        <p className="mt-10 text-sm text-muted-foreground">
          See Mend's{" "}
          <Link to="/privacy" className="underline underline-offset-4">
            privacy policy
          </Link>
          .
        </p>
      </main>
      <footer className="mx-auto w-full max-w-md px-6 pb-10">
        <Link to="/" aria-label="Mend home">
          <Logo height={28} />
        </Link>
      </footer>
    </div>
  );
}
