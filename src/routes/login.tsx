import { zodResolver } from "@hookform/resolvers/zod";
import { isAuthError } from "@supabase/supabase-js";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { AuthLayout, FormAlert } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { emailSchema, friendlyAuthError, safeRedirect } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

export const Route = createFileRoute("/login")({
  // Browser-only so the form can never be submitted natively before the
  // script loads (that would put the password in the URL of a GET request).
  ssr: false,
  // `redirect` is optional so plain links to /login need no search params.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search["redirect"] === "string" ? { redirect: search["redirect"] } : {},
  head: () => ({ meta: [{ title: "Log in · Mend" }] }),
  component: LoginPage,
});

const schema = z.object({
  email: emailSchema,
  // No strength rules here: existing passwords are checked by the server.
  password: z.string().min(1, "Enter your password."),
});
type Values = z.input<typeof schema>;

function LoginPage() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(raw: Values) {
    setError(null);
    setUnconfirmedEmail(null);
    const values = schema.parse(raw);
    const { error } = await getSupabase().auth.signInWithPassword(values);
    if (error) {
      if (isAuthError(error) && error.code === "email_not_confirmed") {
        setUnconfirmedEmail(values.email);
      }
      setError(friendlyAuthError(error));
      return;
    }
    await navigate({ to: safeRedirect(redirect) });
  }

  async function resend() {
    if (!unconfirmedEmail) return;
    const { error } = await getSupabase().auth.resend({
      type: "signup",
      email: unconfirmedEmail,
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
    });
    if (error) setError(friendlyAuthError(error));
    else setResent(true);
  }

  return (
    <AuthLayout
      title="Log in"
      subtitle="Welcome back."
      footer={
        <>
          New to Mend?{" "}
          <Link to="/signup" className="text-primary underline-offset-4 hover:underline">
            Create your shop
          </Link>
        </>
      }
    >
      <Form {...form}>
        <form
          method="post"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
          className="flex flex-col gap-5"
        >
          {error ? <FormAlert tone="error">{error}</FormAlert> : null}
          {unconfirmedEmail ? (
            resent ? (
              <FormAlert tone="info">Sent. Check your email for the new link.</FormAlert>
            ) : (
              <Button type="button" variant="outline" onClick={resend}>
                Send the confirmation link again
              </Button>
            )
          ) : null}
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
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between">
                  <FormLabel>Password</FormLabel>
                  <Link
                    to="/reset-password"
                    className="text-sm text-primary underline-offset-4 hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <FormControl>
                  <Input type="password" autoComplete="current-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Logging in…" : "Log in"}
          </Button>
        </form>
      </Form>
    </AuthLayout>
  );
}
