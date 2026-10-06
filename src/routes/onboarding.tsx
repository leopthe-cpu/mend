import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { AuthLayout, FormAlert } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { getSupabase } from "@/lib/supabase";
import { countryForTimeZone, fetchMyMembership, friendlyDbError, guessTimeZone } from "@/lib/shop";

// First entry after confirming the email (decision 53): no questions here.
// The shop is created with defaults (generated name, trade "Something else",
// country and time zone guessed from the browser) and the Owner finishes
// setup inside the app at /app/setup, where every answer can be changed.
// Exception: someone with a pending invite (e.g. they confirmed in another
// browser, so they arrive here instead of at the invite) or who used to be on
// a team is asked first, so nobody ends up with a shop by accident.
export const Route = createFileRoute("/onboarding")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await getSupabase().auth.getSession();
    const user = data.session?.user;
    if (!user) throw redirect({ to: "/login" });
    if (await fetchMyMembership(user.id)) throw redirect({ to: "/app/board" });
  },
  head: () => ({ meta: [{ title: "Opening your shop · Mend" }] }),
  component: Onboarding,
});

type OnboardingState = {
  pending_invites: { shop_name: string; role: string }[];
  was_member: boolean;
};

function Onboarding() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<OnboardingState | null>(null);
  const started = useRef(false);

  const create = useCallback(async () => {
    setError(null);
    const timeZone = guessTimeZone();
    const country = countryForTimeZone(timeZone);
    const { error } = await getSupabase().rpc("create_shop", {
      p_name: null,
      p_full_name: null,
      p_vertical: "other",
      p_country: country,
      p_currency: country === "US" ? "USD" : "CAD",
      p_time_zone: timeZone,
    });
    // "already belong to a shop" means a second tab got there first: fine.
    if (error && error.code !== "23505") return setError(friendlyDbError(error));
    await navigate({ to: "/app/setup", replace: true });
  }, [navigate]);

  useEffect(() => {
    // Effects can run twice in development; create the shop once.
    if (started.current) return;
    started.current = true;
    void (async () => {
      const { data, error } = await getSupabase().rpc("onboarding_state");
      if (error) return setError(friendlyDbError(error));
      const state = data as OnboardingState;
      if (state.pending_invites.length || state.was_member) return setAsk(state);
      await create();
    })();
  }, [create]);

  if (error) {
    return (
      <AuthLayout title="We couldn't open your shop">
        <FormAlert tone="error">{error}</FormAlert>
        <Button size="lg" className="mt-6 w-full" onClick={() => void create()}>
          Try again
        </Button>
      </AuthLayout>
    );
  }
  if (ask) {
    const invite = ask.pending_invites[0];
    return (
      <AuthLayout
        title={invite ? `${invite.shop_name} invited you` : "You're not on a team any more"}
        subtitle={
          invite
            ? "To join their team, open the invitation link we emailed you, on this device."
            : "The shop you worked with removed your access. Ask the owner for a new invite, or open a shop of your own."
        }
      >
        <Button
          size="lg"
          variant={invite ? "outline" : "default"}
          className="w-full"
          onClick={() => {
            setAsk(null);
            void create();
          }}
        >
          Open my own shop instead
        </Button>
        <Button asChild size="lg" variant="ghost" className="mt-3 w-full">
          <Link to="/">Not now</Link>
        </Button>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Opening your shop…">
      <p className="text-muted-foreground" role="status">
        One moment.
      </p>
    </AuthLayout>
  );
}
