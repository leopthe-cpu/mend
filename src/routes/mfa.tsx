import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { AuthLayout, FormAlert } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { friendlyAuthError, safeRedirect } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

// Second step of sign-in for accounts with an authenticator app (spec §4).
export const Route = createFileRoute("/mfa")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search["redirect"] === "string" ? { redirect: search["redirect"] } : {},
  beforeLoad: async () => {
    const { data } = await getSupabase().auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [{ title: "Two-step check · Mend" }] }),
  component: MfaPage,
});

function MfaPage() {
  const { redirect: target } = Route.useSearch();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data: factors, error: listError } = await getSupabase().auth.mfa.listFactors();
      if (listError) throw listError;
      const factor = factors.totp.find((f) => f.status === "verified");
      if (!factor) return navigate({ to: safeRedirect(target) });
      const { error } = await getSupabase().auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code: code.trim(),
      });
      if (error) throw error;
      await navigate({ to: safeRedirect(target), replace: true });
    } catch (err) {
      setError(
        friendlyAuthError(err) === "Something went wrong. Please try again."
          ? "That code didn't work. Check your authenticator app and try again."
          : friendlyAuthError(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Enter your 6-digit code"
      subtitle="Open your authenticator app and type the code shown for Mend."
      footer={
        <button
          type="button"
          className="text-primary underline-offset-4 hover:underline"
          onClick={() =>
            void getSupabase()
              .auth.signOut()
              .then(() => navigate({ to: "/login" }))
          }
        >
          Use a different account
        </button>
      }
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-5">
        {error ? <FormAlert tone="error">{error}</FormAlert> : null}
        <div className="flex flex-col gap-2">
          <Label htmlFor="code">Code</Label>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            autoFocus
          />
        </div>
        <Button type="submit" size="lg" disabled={busy || code.length !== 6}>
          {busy ? "Checking…" : "Continue"}
        </Button>
      </form>
    </AuthLayout>
  );
}
