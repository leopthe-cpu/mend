import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
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
import { emailSchema, friendlyAuthError, passwordSchema, guard } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

export const Route = createFileRoute("/signup")({
  // Browser-only so the form can never be submitted natively before the
  // script loads (that would put the password in the URL of a GET request).
  ssr: false,
  head: () => ({ meta: [{ title: "Create your shop · Mend" }] }),
  component: SignupPage,
});

const schema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
type Values = z.input<typeof schema>;

function SignupPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(raw: Values) {
    setError(null);
    const values = schema.parse(raw);
    // Just email and password here. Shop name and your name are asked during
    // onboarding, and both can be skipped (decision 17).
    const { error } = await getSupabase().auth.signUp({
      email: values.email,
      password: values.password,
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
    });
    if (error) {
      setError(friendlyAuthError(error));
      return;
    }
    // Same message whether or not the address already has an account, so the
    // form can't be used to find out who uses Mend.
    setSentTo(values.email);
  }

  if (sentTo) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle={
          <>
            We sent a confirmation link to <strong className="text-foreground">{sentTo}</strong>.
            Open it on this device to finish setting up your shop.
          </>
        }
        footer={
          <>
            Wrong address?{" "}
            <button
              type="button"
              className="text-primary underline-offset-4 hover:underline"
              onClick={() => setSentTo(null)}
            >
              Start again
            </button>
          </>
        }
      >
        <FormAlert tone="info">
          The link expires after a while. You can request a new one when you log in.
        </FormAlert>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your shop"
      subtitle="Just an email and a password to start."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="text-primary underline-offset-4 hover:underline">
            Log in
          </Link>
        </>
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
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
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
          <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Creating account…" : "Create account"}
          </Button>
          <p className="text-sm text-muted-foreground">
            By creating an account you agree to the{" "}
            <Link to="/terms" className="underline underline-offset-4">
              terms
            </Link>{" "}
            and{" "}
            <Link to="/privacy" className="underline underline-offset-4">
              privacy policy
            </Link>
            .
          </p>
        </form>
      </Form>
    </AuthLayout>
  );
}
