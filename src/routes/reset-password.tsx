import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { AuthLayout, FormAlert } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  emailSchema,
  friendlyAuthError,
  passwordSchema,
  readAuthRedirectError,
  guard,
} from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

// Two steps on one page: (1) ask for a reset link; (2) the link comes back
// here with a one-time `?code=` (PKCE) that we exchange for a short recovery
// session, then the person sets a new password.
export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({ meta: [{ title: "Reset password · Mend" }] }),
  component: ResetPasswordPage,
});

type Mode = "request" | "checking" | "set" | { error: string };

function ResetPasswordPage() {
  const [mode, setMode] = useState<Mode>(() =>
    new URL(window.location.href).searchParams.has("code") ||
    readAuthRedirectError(window.location.href)
      ? "checking"
      : "request",
  );
  const ran = useRef(false);

  useEffect(() => {
    if (mode !== "checking" || ran.current) return;
    ran.current = true;
    void (async () => {
      const linkError = readAuthRedirectError(window.location.href);
      if (linkError) return setMode({ error: linkError });
      const code = new URL(window.location.href).searchParams.get("code");
      if (!code) return setMode("request");
      const { error } = await getSupabase().auth.exchangeCodeForSession(code);
      if (error) return setMode({ error: friendlyAuthError(error) });
      // Drop the used code from the address bar.
      window.history.replaceState(null, "", "/reset-password");
      setMode("set");
    })();
  }, [mode]);

  if (mode === "checking") {
    return (
      <AuthLayout title="Checking your link…">
        <p role="status" className="text-muted-foreground">
          One moment.
        </p>
      </AuthLayout>
    );
  }
  if (mode === "set") return <SetPasswordForm />;
  return <RequestForm linkError={typeof mode === "object" ? mode.error : null} />;
}

const requestSchema = z.object({ email: emailSchema });
type RequestValues = z.input<typeof requestSchema>;

function RequestForm({ linkError }: { linkError: string | null }) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(linkError);
  const form = useForm<RequestValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(raw: RequestValues) {
    setError(null);
    const { email } = requestSchema.parse(raw);
    const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) return setError(friendlyAuthError(error));
    // Same message whether or not the account exists.
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle={
          <>
            If <strong className="text-foreground">{sentTo}</strong> has a Mend account, we've sent
            a link to reset the password. Open it on this device.
          </>
        }
        footer={
          <Link
            to="/login"

            className="text-primary underline-offset-4 hover:underline"
          >
            Back to log in
          </Link>
        }
      >
        {null}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter your email and we'll send you a link."
      footer={
        <Link
          to="/login"

          className="text-primary underline-offset-4 hover:underline"
        >
          Back to log in
        </Link>
      }
    >
      <Form {...form}>
        <form
          method="post"
          onSubmit={form.handleSubmit(guard(onSubmit, setError))}
          noValidate
          className="flex flex-col gap-5"
        >
          {error ? <FormAlert tone="error">{error}</FormAlert> : null}
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="email" inputMode="email" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      </Form>
    </AuthLayout>
  );
}

const setSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    message: "The passwords don't match.",
    path: ["confirm"],
  });
type SetValues = z.input<typeof setSchema>;

function SetPasswordForm() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<SetValues>({
    resolver: zodResolver(setSchema),
    defaultValues: { password: "", confirm: "" },
  });

  async function onSubmit(raw: SetValues) {
    setError(null);
    const { password } = setSchema.parse(raw);
    const { error } = await getSupabase().auth.updateUser({ password });
    if (error) return setError(friendlyAuthError(error));
    await navigate({ to: "/app/board", replace: true });
  }

  return (
    <AuthLayout title="Choose a new password">
      <Form {...form}>
        <form
          method="post"
          onSubmit={form.handleSubmit(guard(onSubmit, setError))}
          noValidate
          className="flex flex-col gap-5"
        >
          {error ? <FormAlert tone="error">{error}</FormAlert> : null}
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>New password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" {...field} />
                </FormControl>
                <FormDescription>
                  At least 6 characters, with upper and lowercase letters and a number.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirm"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Type it again</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Saving…" : "Save and log in"}
          </Button>
        </form>
      </Form>
    </AuthLayout>
  );
}
