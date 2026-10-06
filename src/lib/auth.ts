import { isAuthError, isAuthWeakPasswordError } from "@supabase/supabase-js";
import { z } from "zod";

import { SupabaseConfigError } from "./supabase";

// Mirrors the Auth settings (supabase/config.toml and the hosted dashboard):
// 6+ characters with lowercase, uppercase and a digit (decision 10, revised by
// Oz on 2026-10-06). The server enforces it
// regardless; this only gives a friendly message before submitting.
export const PASSWORD_MIN_LENGTH = 6;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(72, "Use at most 72 characters.") // bcrypt only uses the first 72 bytes
  .regex(/[a-z]/, "Add a lowercase letter.")
  .regex(/[A-Z]/, "Add an uppercase letter.")
  .regex(/[0-9]/, "Add a number.");

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .email("Enter a valid email address.")
  .max(254)
  .transform((v) => v.toLowerCase());

/**
 * Where to go after login. Only same-site paths inside the app are allowed so
 * a crafted ?redirect= link can't bounce someone to another site.
 */
export function safeRedirect(target: unknown, fallback = "/app/board"): string {
  if (typeof target !== "string") return fallback;
  // In-app pages, plus invite links (to come back after signing up).
  if (!target.startsWith("/app") && !target.startsWith("/invite/")) return fallback;
  if (target.startsWith("//") || target.includes("\\")) return fallback;
  try {
    const url = new URL(target, "https://mend.invalid");
    if (url.origin !== "https://mend.invalid") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

/**
 * The server's password rules (set in the Supabase dashboard) are the source
 * of truth, so describe what *it* rejected rather than repeating our own copy
 * of the rules. Its raw message lists whole alphabets; this rewrites it.
 */
export function weakPasswordMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const reasons = isAuthWeakPasswordError(error) ? error.reasons : [];
  const parts: string[] = [];
  const length = /at least (\d+) characters/i.exec(message)?.[1];
  if (length) parts.push(`at least ${length} characters`);
  const needs: string[] = [];
  if (/abcdefghijklmnopqrstuvwxyz/.test(message)) needs.push("a lowercase letter");
  if (/ABCDEFGHIJKLMNOPQRSTUVWXYZ/.test(message)) needs.push("an uppercase letter");
  if (/0123456789/.test(message)) needs.push("a number");
  if (/[!@#$%^&*]{3,}/.test(message)) needs.push("a symbol");
  if (needs.length) parts.push(needs.join(", "));
  if (reasons.includes("pwned")) {
    return "That password has appeared in a data breach. Please choose a different one.";
  }
  return parts.length
    ? `That password is too weak. Use ${parts.join(", with ")}.`
    : "That password is too weak. Try a longer one with upper and lowercase letters and a number.";
}

/** Plain-language messages for the auth errors people actually hit. */
export function friendlyAuthError(error: unknown): string {
  if (error instanceof SupabaseConfigError) {
    return "Mend isn't connected to its database in this environment yet.";
  }
  if (error instanceof TypeError) {
    // fetch() rejects with a TypeError when the network is unreachable.
    return "Can't reach Mend right now. Check your connection and try again.";
  }
  const code = isAuthError(error) ? error.code : undefined;
  switch (code) {
    case "invalid_credentials":
      return "That email and password don't match. Check them and try again.";
    case "email_not_confirmed":
      return "Please confirm your email first. We can send the link again.";
    case "weak_password":
      return weakPasswordMessage(error);
    case "same_password":
      return "Choose a password you haven't used here before.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Too many attempts. Please wait a minute and try again.";
    case "flow_state_not_found":
    case "flow_state_expired":
    case "bad_code_verifier":
    case "otp_expired":
      return "This link has expired or was opened in a different browser. Request a new one.";
    case "user_banned":
      return "This account is disabled.";
    default:
      return "Something went wrong. Please try again.";
  }
}

/** Error info that Supabase Auth appends to a redirect URL (query or fragment). */
export function readAuthRedirectError(href: string): string | null {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const description =
    url.searchParams.get("error_description") ?? hash.get("error_description") ?? null;
  const error = url.searchParams.get("error") ?? hash.get("error");
  if (!error && !description) return null;
  const code = url.searchParams.get("error_code") ?? hash.get("error_code");
  if (code === "otp_expired") return "This link has expired. Request a new one.";
  return description ?? "This link isn't valid any more. Request a new one.";
}

/**
 * Wraps a form submit handler so unexpected failures (no network, missing
 * config) show a plain message instead of failing silently.
 */
export function guard<T>(
  handler: (values: T) => Promise<unknown>,
  setError: (message: string) => void,
): (values: T) => Promise<void> {
  return async (values) => {
    try {
      await handler(values);
    } catch (error) {
      setError(friendlyAuthError(error));
    }
  };
}
