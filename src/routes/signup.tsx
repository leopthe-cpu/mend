import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { emailSchema, friendlyAuthError, guard, passwordSchema, safeRedirect } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

export const Route = createFileRoute("/signup")({
  // `next`: where to go after confirming the email (e.g. back to an invite).
  validateSearch: (search: Record<string, unknown>): { next?: string } =>
    typeof search["next"] === "string" ? { next: search["next"] } : {},
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
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(raw: Values) {
    setError(null);
    const values = schema.parse(raw);
    const { error } = await getSupabase().auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        emailRedirectTo:
          `${window.location.origin}/auth/confirm` +
          (next ? `?next=${encodeURIComponent(safeRedirect(next))}` : ""),
      },
    });
    if (error) {
      setError(friendlyAuthError(error));
      return;
    }
    setEmail(values.email);
  }

  async function verifyCode() {
    if (otp.length !== 6 || !email) return;
    setVerifying(true);
    setError(null);
    const { error } = await getSupabase().auth.verifyOtp({
      email,
      token: otp,
      type: "email",
    });
    setVerifying(false);
    if (error) {
      if (error.code === "otp_expired" || error.code === "token_invalid") {
        setError("That code didn't work. Check it and try again, or request a new one.");
        return;
      }
      setError(friendlyAuthError(error));
      return;
    }
    await navigate({ to: safeRedirect(next, "/onboarding"), replace: true });
  }

  async function resendCode() {
    if (!email) return;
    setResending(true);
    setError(null);
    const { error } = await getSupabase().auth.resend({ type: "signup", email });
    setResending(false);
    if (error) {
      setError(friendlyAuthError(error));
      return;
    }
    setOtp("");
  }

  // If signed up, show the OTP code screen with link fallback.
  if (email) {
    const canSubmit = otp.length === 6;
    return (
      <AuthLayout
        title="Check your email"
        subtitle={
          <>
            We sent a 6‑digit code to <strong className="text-foreground">{email}</strong>.
            Enter it below to confirm your address.
          </>
        }
        footer={
          <>
            Wrong address?{" "}
            <button
              type="button"
              className="text-primary underline-offset-4 hover:underline"
              onClick={() => {
                setEmail(null);
                setOtp("");
                setError(null);
              }}
            >
              Start again
            </button>
          </>
        }
      >
        {error ? <FormAlert tone="error">{error}</FormAlert> : null}
        <div className="mt-6 flex flex-col items-center gap-6">
          <InputOTP maxLength={6} value={otp} onChange={setOtp}>
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
          <Button
            size="lg"
            className="w-full"
            disabled={!canSubmit || verifying}
            onClick={() => void verifyCode()}
          >
            {verifying ? "Verifying…" : "Confirm email"}
          </Button>
          <div className="flex flex-col items-center gap-1">
            <Button
              variant="link"
              size="sm"
              disabled={resending}
              onClick={() => void resendCode()}
            >
              {resending ? "Sending…" : "Send a new code"}
            </Button>
            <p className="text-sm text-muted-foreground">
              Can't find it? Check your spam folder. You can also use the
              confirmation link in the email — open it on this device.
            </p>
          </div>
        </div>
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
          <Link
            to="/login"
            search={next ? { redirect: next } : {}}
            className="text-primary underline-offset-4 hover:underline"
          >
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