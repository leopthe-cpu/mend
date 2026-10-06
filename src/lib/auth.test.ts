import { AuthApiError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  emailSchema,
  friendlyAuthError,
  guard,
  passwordSchema,
  readAuthRedirectError,
  safeRedirect,
} from "./auth";
import { SupabaseConfigError } from "./supabase";

describe("passwordSchema", () => {
  it("accepts 12+ chars with lower, upper and digit", () => {
    expect(passwordSchema.safeParse("Correct-Horse-9").success).toBe(true);
  });
  it.each(["Short1a", "alllowercase123", "ALLUPPERCASE123", "NoDigitsHereAtAll"])(
    "rejects %s",
    (pw) => expect(passwordSchema.safeParse(pw).success).toBe(false),
  );
});

describe("emailSchema", () => {
  it("trims and lowercases", () => {
    expect(emailSchema.parse("  Maria@Example.COM ")).toBe("maria@example.com");
  });
});

describe("safeRedirect", () => {
  it("keeps in-app paths", () => {
    expect(safeRedirect("/app/tickets?x=1")).toBe("/app/tickets?x=1");
  });
  it.each([
    "https://evil.example/app",
    "//evil.example/app",
    "/\\evil.example",
    "/login",
    42,
    undefined,
  ])("falls back for %s", (t) => expect(safeRedirect(t)).toBe("/app/board"));
});

describe("friendlyAuthError", () => {
  it("maps known codes to plain language", () => {
    const err = new AuthApiError("Invalid login credentials", 400, "invalid_credentials");
    expect(friendlyAuthError(err)).toMatch(/don't match/);
  });
  it("never leaks raw messages for unknown errors", () => {
    expect(friendlyAuthError(new Error("db exploded: secret"))).toBe(
      "Something went wrong. Please try again.",
    );
  });
});

describe("readAuthRedirectError", () => {
  it("reads errors from the fragment", () => {
    expect(
      readAuthRedirectError(
        "https://x.test/auth/confirm#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid",
      ),
    ).toMatch(/expired/);
  });
  it("returns null when there is no error", () => {
    expect(readAuthRedirectError("https://x.test/auth/confirm?code=abc")).toBeNull();
  });
});

describe("guard", () => {
  it("turns thrown errors into a plain message", async () => {
    const messages: string[] = [];
    await guard(
      async () => {
        throw new SupabaseConfigError("missing env");
      },
      (m: string) => messages.push(m),
    )(undefined);
    expect(messages).toEqual(["Mend isn't connected to its database in this environment yet."]);
  });
});
