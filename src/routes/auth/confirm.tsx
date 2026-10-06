import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { AuthLayout, FormAlert } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { readAuthRedirectError } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

// Landing page for the email-confirmation link (PKCE: `?code=`). Supabase Auth
// has already confirmed the address before redirecting here; we only turn the
// one-time code into a session on this device.
export const Route = createFileRoute("/auth/confirm")({
  ssr: false,
  head: () => ({ meta: [{ title: "Confirming your email · Mend" }] }),
  component: ConfirmPage,
});

type State = { kind: "working" } | { kind: "error"; message: string } | { kind: "login" };

function ConfirmPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "working" });
  const ran = useRef(false);

  useEffect(() => {
    // The code is single-use; guard against React running effects twice.
    if (ran.current) return;
    ran.current = true;
    void (async () => {
      const linkError = readAuthRedirectError(window.location.href);
      if (linkError) {
        setState({ kind: "error", message: linkError });
        return;
      }
      const code = new URL(window.location.href).searchParams.get("code");
      if (!code) {
        setState({ kind: "error", message: "This link is incomplete. Request a new one." });
        return;
      }
      const { error } = await getSupabase().auth.exchangeCodeForSession(code);
      if (error) {
        // Most often: the link was opened in a different browser than the one
        // used to sign up (Auth has still confirmed the email), or it was
        // already used. We can't tell which here, so send them to log in.
        setState({ kind: "login" });
        return;
      }
      await navigate({ to: "/app/board", replace: true });
    })();
  }, [navigate]);

  if (state.kind === "working") {
    return (
      <AuthLayout title="Confirming your email…">
        <p className="text-muted-foreground" role="status">
          One moment.
        </p>
      </AuthLayout>
    );
  }
  if (state.kind === "login") {
    return (
      <AuthLayout
        title="Almost there"
        subtitle="This link was opened in a different browser, or it has already been used. If you've confirmed your email, log in to continue."
      >
        <Button asChild size="lg" className="w-full">
          <Link to="/login">Log in</Link>
        </Button>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="That link didn't work">
      <FormAlert tone="error">{state.message}</FormAlert>
      <p className="mt-6 text-muted-foreground">
        Log in and we'll offer to send a new confirmation link.
      </p>
      <Button asChild size="lg" className="mt-4 w-full">
        <Link to="/login">Go to log in</Link>
      </Button>
    </AuthLayout>
  );
}
