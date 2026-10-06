import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { Field, Panel } from "@/components/app/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyAuthError } from "@/lib/auth";
import { roleAtLeast } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";

// Optional authenticator-app (TOTP) two-step sign-in for Owners and Admins
// (spec §4; addendum §10: MFA lives under Settings → Security).
export const Route = createFileRoute("/app/settings/security")({
  component: SecuritySettings,
});

type Factor = { id: string; status: string; friendly_name?: string | null };
type Enrolling = { factorId: string; qr: string; secret: string };

function SecuritySettings() {
  const { membership } = Route.useRouteContext();
  const offered = roleAtLeast(membership.role, "admin");
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase().auth.mfa.listFactors();
    if (error) return setMessage({ tone: "error", text: friendlyAuthError(error) });
    setFactors((data?.totp ?? []) as Factor[]);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const verified = factors.find((f) => f.status === "verified");

  async function start() {
    setBusy(true);
    setMessage(null);
    const sb = getSupabase();
    // Clear any half-finished setup first.
    for (const f of factors.filter((x) => x.status !== "verified")) {
      await sb.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await sb.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Authenticator app",
    });
    setBusy(false);
    if (error) return setMessage({ tone: "error", text: friendlyAuthError(error) });
    setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!enrolling) return;
    setBusy(true);
    const { error } = await getSupabase().auth.mfa.challengeAndVerify({
      factorId: enrolling.factorId,
      code: code.trim(),
    });
    setBusy(false);
    if (error)
      return setMessage({
        tone: "error",
        text: "That code didn't work. Check the time on your phone and try again.",
      });
    setEnrolling(null);
    setCode("");
    setMessage({
      tone: "info",
      text: "Two-step sign-in is on. You'll be asked for a code each time you log in.",
    });
    await load();
  }

  async function turnOff() {
    if (!verified || !window.confirm("Turn off two-step sign-in?")) return;
    const { error } = await getSupabase().auth.mfa.unenroll({ factorId: verified.id });
    if (error) return setMessage({ tone: "error", text: friendlyAuthError(error) });
    await getSupabase().auth.refreshSession();
    setMessage({ tone: "info", text: "Two-step sign-in is off." });
    await load();
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {message ? <FormAlert tone={message.tone}>{message.text}</FormAlert> : null}
      <Panel
        title="Two-step sign-in"
        description="After your password, you'll enter a 6-digit code from an authenticator app such as Google Authenticator, 1Password or Authy."
      >
        {!offered ? (
          <p className="text-muted-foreground">
            Two-step sign-in is available to Owners and Admins.
          </p>
        ) : verified ? (
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-mono text-sm uppercase text-success">On</span>
            <Button variant="outline" onClick={() => void turnOff()}>
              Turn off
            </Button>
          </div>
        ) : enrolling ? (
          <form method="post" onSubmit={confirm} className="flex flex-col gap-4">
            <ol className="list-decimal space-y-1 pl-5">
              <li>Open your authenticator app and scan this code.</li>
              <li>Type the 6-digit code it shows.</li>
            </ol>
            <img
              src={enrolling.qr}
              alt="QR code to add Mend to your authenticator app"
              width={200}
              height={200}
              className="rounded-md bg-white p-2"
            />
            <p className="text-sm text-muted-foreground">
              Can't scan? Enter this key instead:{" "}
              <span className="font-mono break-all text-foreground">{enrolling.secret}</span>
            </p>
            <Field id="totp-code" label="Code">
              <Input
                id="totp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="max-w-40"
              />
            </Field>
            <div className="flex gap-3">
              <Button type="submit" disabled={busy || code.length !== 6}>
                Turn on
              </Button>
              <Button type="button" variant="outline" onClick={() => setEnrolling(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button onClick={() => void start()} disabled={busy}>
            Set up authenticator app
          </Button>
        )}
      </Panel>
    </div>
  );
}
