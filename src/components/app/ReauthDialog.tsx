import { useState, type ReactNode } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { Field } from "@/components/app/Field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getSupabase } from "@/lib/supabase";

// For actions the database only allows right after a fresh sign-in
// (private.recently_reauthenticated: password within 10 minutes, plus the MFA
// code when the account has one). Asks for the password (then the code if
// needed), signs in again, then runs `action`. Errors thrown by `action` are
// shown in the dialog. Used by ownership transfer, data export and shop
// deletion.
export function ReauthDialog({
  title,
  description,
  email,
  confirmLabel,
  busyLabel,
  destructive = false,
  canConfirm = true,
  children,
  action,
  onClose,
}: {
  title: string;
  description: ReactNode;
  email: string;
  confirmLabel: string;
  busyLabel: string;
  destructive?: boolean;
  /** Extra checks the caller needs (e.g. a typed confirmation) before submit. */
  canConfirm?: boolean;
  children?: ReactNode;
  action: () => Promise<void>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!canConfirm) return;
    setBusy(true);
    setError(null);
    const sb = getSupabase();
    try {
      if (!needsCode) {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw new Error("That password isn't right.");
        const { data: factors } = await sb.auth.mfa.listFactors();
        if (factors?.totp.some((f) => f.status === "verified")) {
          setNeedsCode(true);
          return;
        }
      } else {
        const { data: factors } = await sb.auth.mfa.listFactors();
        const factor = factors?.totp.find((f) => f.status === "verified");
        if (factor) {
          const { error } = await sb.auth.mfa.challengeAndVerify({
            factorId: factor.id,
            code: code.trim(),
          });
          if (error) throw new Error("That code didn't work.");
        }
      }
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="bg-background text-foreground">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form method="post" onSubmit={confirm} className="flex flex-col gap-4">
          {error ? <FormAlert tone="error">{error}</FormAlert> : null}
          {children}
          {!needsCode ? (
            <Field id="confirm-password" label="Your password">
              <Input
                id="confirm-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
          ) : (
            <Field id="confirm-code" label="Code from your authenticator app">
              <Input
                id="confirm-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                required
              />
            </Field>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={busy || !canConfirm}
            >
              {busy ? busyLabel : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
