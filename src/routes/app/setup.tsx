import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { Check, Copy, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { PageHeader } from "@/components/app/EmptyState";
import { Field, selectClass } from "@/components/app/Field";
import { Button } from "@/components/ui/button";
import { PhoneInput } from "@/components/app/MaskedInputs";
import { WeeklyHoursEditor } from "@/components/app/WeeklyHoursEditor";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabase } from "@/lib/supabase";
import { defaultSchedule, scheduleToText, type WeeklySchedule } from "@/lib/hours";
import {
  countryForTimeZone,
  friendlyDbError,
  guessTimeZone,
  roleAtLeast,
  ROLE_LABEL,
  TIME_ZONES,
  VERTICALS,
  type Role,
  type Vertical,
} from "@/lib/shop";
import { cn } from "@/lib/utils";

// Finish setting up, inside the app (decision 53). The shop already exists
// with defaults; this saves the Owner's answers via finish_shop_setup() and
// can be left for later at any step. Once finished, changes go through
// Settings. The invite step comes after the save so the team is ready from
// day one.
export const Route = createFileRoute("/app/setup")({
  beforeLoad: ({ context }) => {
    if (context.membership.shop.setup_completed_at) throw redirect({ to: "/app/settings/shop" });
  },
  head: () => ({ meta: [{ title: "Finish setting up · Mend" }] }),
  component: Setup,
});

type TaxRow = { name: string; rate: string };
const STEPS = ["Names", "Your trade", "Location & hours", "Taxes", "Invite your team"] as const;

function Setup() {
  const { membership } = Route.useRouteContext();
  const shop = membership.shop;
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  // Step 0 — Names
  const [shopName, setShopName] = useState(shop.name);
  const [fullName, setFullName] = useState("");

  // Step 1 — Trade
  const [vertical, setVertical] = useState<Vertical>(shop.vertical);

  // Step 2 — Location & hours
  const [country, setCountry] = useState<"CA" | "US">(shop.country);
  const [timeZone, setTimeZone] = useState(shop.time_zone);
  const [showTzPicker, setShowTzPicker] = useState(false);
  const [address, setAddress] = useState(shop.address ?? "");
  const [phone, setPhone] = useState(shop.phone ?? "");
  const [schedule, setSchedule] = useState<WeeklySchedule>(
    shop.business_hours?.schedule ?? defaultSchedule(),
  );
  const existingHoursText =
    shop.business_hours?.text && !shop.business_hours?.schedule ? shop.business_hours.text : null;

  // Step 3 — Taxes
  const [taxes, setTaxes] = useState<TaxRow[]>([{ name: "", rate: "" }]);

  // Step 4 — Invite
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("staff");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!roleAtLeast(membership.role, "admin")) {
    return (
      <>
        <PageHeader title="Finish setting up" />
        <p className="max-w-xl text-muted-foreground">
          An Admin is still setting things up. You can start using Mend in the meantime.
        </p>
      </>
    );
  }

  const taxErrors = taxes.map((t) => {
    if (!t.name.trim() && !t.rate.trim()) return null;
    const rate = Number(t.rate);
    if (!t.name.trim()) return "Give this tax a name, like HST.";
    if (t.rate.trim() === "" || Number.isNaN(rate) || rate < 0 || rate > 100)
      return "Enter a rate between 0 and 100.";
    return null;
  });

  async function finishSetup(skipTaxes?: boolean) {
    if (!skipTaxes && taxErrors.some(Boolean)) return;
    if (!shopName.trim()) {
      setStep(0);
      return setError("The shop needs a name.");
    }
    const contactMsg = contactError();
    if (contactMsg) {
      setStep(2);
      return setError(contactMsg);
    }
    setSaving(true);
    setError(null);
    const { error } = await getSupabase().rpc("finish_shop_setup", {
      p_shop_id: shop.id,
      p_name: shopName.trim(),
      p_full_name: fullName.trim() || null,
      p_vertical: vertical,
      p_country: country,
      p_time_zone: timeZone,
      p_address: address.trim(),
      p_phone: phone.trim(),
      p_business_hours: { text: scheduleToText(schedule), schedule },
      p_tax_rates: skipTaxes
        ? []
        : taxes
            .filter((t) => t.name.trim() && t.rate.trim())
            .map((t) => ({ name: t.name.trim(), rate: Number(t.rate) })),
    });
    setSaving(false);
    if (error) return setError(friendlyDbError(error));
    // Advance to the invite step without navigating (the guard won't re-fire
    // because we stay on the same page).
    setStep(4);
  }

  async function inviteSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInviteLink(null);
    setCopied(false);
    const { data, error } = await getSupabase().rpc("create_invite", {
      p_shop_id: shop.id,
      p_email: inviteEmail,
      p_role: inviteRole,
    });
    if (error) return setError(friendlyDbError(error));
    const token = (data as { token: string }[])[0]?.token;
    if (token) setInviteLink(`${window.location.origin}/invite/${token}`);
    setInviteEmail("");
  }

  async function done() {
    await navigate({ to: "/app/board", replace: true });
  }

  // Decision 76: texts identify the shop (CASL), so address and phone are
  // required before leaving the "Location & hours" step.
  const contactError = () =>
    !address.trim() || phone.replace(/\D/g, "").length < 10
      ? "Add your shop's address and phone. Customers see them on your shop's contact page, linked from your texts."
      : null;
  const next = () => {
    if (step === 2) {
      const msg = contactError();
      if (msg) return setError(msg);
      setError(null);
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));
  const skip = () => {
    setError(null);
    if (step === 3) {
      // Taxes: save everything with no tax rates, then invite step.
      void finishSetup(true);
      return;
    }
    if (step === STEPS.length - 1) {
      void done();
    } else {
      next();
    }
  };

  const tzLabel = TIME_ZONES.find((z) => z.value === timeZone)?.label ?? timeZone;
  const tzGuess = guessTimeZone();
  const countryGuess = countryForTimeZone(tzGuess);

  return (
    <>
      <PageHeader title="Finish setting up">
        <Button asChild variant="ghost">
          <Link to="/app/board">Do this later</Link>
        </Button>
      </PageHeader>
      <div className="max-w-xl">
        <p className="text-muted-foreground">
          Your shop is open and ready to use. A few answers make your board, ticket fields and
          customer messages fit your work.
        </p>
        <ol className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Steps">
          {STEPS.map((label, i) => (
            <li
              key={label}
              aria-current={i === step ? "step" : undefined}
              className={cn(
                "tabular-nums",
                i === step ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {i + 1}. {label}
            </li>
          ))}
        </ol>

        <section className="mt-6 flex flex-col gap-5 rounded-[1.75rem] bg-card p-6">
          {error ? <FormAlert tone="error">{error}</FormAlert> : null}

          {/* ─── Step 0: Names ─── */}
          {step === 0 && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="shop-name">Shop name</Label>
                <Input
                  id="shop-name"
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  autoComplete="organization"
                  maxLength={120}
                />
                <p className="text-sm text-muted-foreground">
                  We picked this one for you. Customers see it in messages and on invoices.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="full-name">Your name</Label>
                <Input
                  id="full-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  autoComplete="name"
                  maxLength={120}
                />
                <p className="text-sm text-muted-foreground">
                  Optional. Until you add it, we'll show your email.
                </p>
              </div>
              <Button variant="ghost" className="self-start" onClick={skip}>
                Skip this step
              </Button>
              <Button size="lg" onClick={next}>
                Continue
              </Button>
            </>
          )}

          {/* ─── Step 1: Trade ─── */}
          {step === 1 && (
            <>
              <fieldset>
                <legend className="mb-3 font-medium">What do you repair?</legend>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  {VERTICALS.map((v) => (
                    <label
                      key={v.value}
                      className={cn(
                        "flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-input p-3 text-center transition-colors",
                        vertical === v.value ? "border-primary bg-surface-2" : "hover:bg-surface-2",
                      )}
                    >
                      <input
                        type="radio"
                        name="vertical"
                        value={v.value}
                        checked={vertical === v.value}
                        onChange={() => setVertical(v.value)}
                        className="sr-only"
                      />
                      <span className="text-sm font-medium">{v.label}</span>
                      <span className="text-xs text-muted-foreground">{v.hint}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="text-sm text-muted-foreground">
                We'll set up matching board columns, ticket fields and a starter price list. You can
                change all of it later in Settings. The trade itself can only change before your
                first ticket.
              </p>
              <Button variant="ghost" className="self-start" onClick={skip}>
                Skip this step
              </Button>
              <div className="flex gap-3">
                <Button size="lg" variant="outline" onClick={back}>
                  Back
                </Button>
                <Button size="lg" className="flex-1" onClick={next}>
                  Continue
                </Button>
              </div>
            </>
          )}

          {/* ─── Step 2: Location & hours ─── */}
          {step === 2 && (
            <>
              <div className="flex flex-col gap-2">
                <Label>Country &amp; time zone</Label>
                {showTzPicker ? (
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <select
                      value={country}
                      onChange={(e) => {
                        setCountry(e.target.value as "CA" | "US");
                        if (e.target.value === "US") setTimeZone("America/New_York");
                        else setTimeZone("America/Toronto");
                      }}
                      className={selectClass}
                    >
                      <option value="CA">Canada (CAD)</option>
                      <option value="US">United States (USD)</option>
                    </select>
                    <select
                      value={timeZone}
                      onChange={(e) => setTimeZone(e.target.value)}
                      className={selectClass}
                    >
                      {TIME_ZONES.filter((z) =>
                        country === "US"
                          ? [
                              "America/New_York",
                              "America/Chicago",
                              "America/Denver",
                              "America/Phoenix",
                              "America/Los_Angeles",
                              "America/Anchorage",
                              "Pacific/Honolulu",
                            ].includes(z.value)
                          : ![
                              "America/New_York",
                              "America/Chicago",
                              "America/Denver",
                              "America/Phoenix",
                              "America/Los_Angeles",
                              "America/Anchorage",
                              "Pacific/Honolulu",
                            ].includes(z.value),
                      ).map((z) => (
                        <option key={z.value} value={z.value}>
                          {z.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <p className="text-sm">
                    {country === "CA" ? "Canada" : "United States"} · {tzLabel}{" "}
                    {country !== countryGuess || timeZone !== tzGuess ? null : (
                      <span className="text-muted-foreground">(from your device)</span>
                    )}
                    <button
                      type="button"
                      className="ml-2 text-primary underline-offset-4 hover:underline"
                      onClick={() => setShowTzPicker(true)}
                    >
                      Change
                    </button>
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="address">Address *</Label>
                <Input
                  id="address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  autoComplete="street-address"
                  maxLength={500}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="phone">Shop phone *</Label>
                <PhoneInput id="phone" value={phone} onValueChange={setPhone} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Shop hours</Label>
                {existingHoursText ? (
                  <p className="text-sm text-muted-foreground">
                    Your current hours: {existingHoursText}
                  </p>
                ) : null}
                <WeeklyHoursEditor value={schedule} onChange={setSchedule} />
                <p className="text-sm text-muted-foreground">
                  Shown in "your item is ready" messages and on your shop page.
                </p>
              </div>
              <Button variant="ghost" className="self-start" onClick={skip}>
                Skip this step
              </Button>
              <div className="flex gap-3">
                <Button size="lg" variant="outline" onClick={back}>
                  Back
                </Button>
                <Button size="lg" className="flex-1" onClick={next}>
                  Continue
                </Button>
              </div>
            </>
          )}

          {/* ─── Step 3: Taxes ─── */}
          {step === 3 && (
            <>
              <p className="text-muted-foreground">
                Add the sales taxes you charge, for example HST 13. You can skip this and add them
                later.
              </p>
              {taxes.map((t, i) => (
                <div key={i} className="flex flex-col gap-1">
                  <div className="flex items-end gap-2">
                    <div className="flex flex-1 flex-col gap-2">
                      <Label htmlFor={`tax-name-${i}`}>Tax name</Label>
                      <Input
                        id={`tax-name-${i}`}
                        value={t.name}
                        maxLength={40}
                        onChange={(e) =>
                          setTaxes(
                            taxes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                          )
                        }
                      />
                    </div>
                    <div className="flex w-28 flex-col gap-2">
                      <Label htmlFor={`tax-rate-${i}`}>Rate (%)</Label>
                      <Input
                        id={`tax-rate-${i}`}
                        inputMode="decimal"
                        value={t.rate}
                        onChange={(e) =>
                          setTaxes(
                            taxes.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)),
                          )
                        }
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove this tax"
                      onClick={() =>
                        setTaxes(
                          taxes.length > 1
                            ? taxes.filter((_, j) => j !== i)
                            : [{ name: "", rate: "" }],
                        )
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  {taxErrors[i] ? <p className="text-sm text-danger">{taxErrors[i]}</p> : null}
                </div>
              ))}
              {taxes.length < 5 ? (
                <Button
                  variant="outline"
                  onClick={() => setTaxes([...taxes, { name: "", rate: "" }])}
                >
                  <Plus /> Tax
                </Button>
              ) : null}
              <Button variant="ghost" className="self-start" onClick={skip}>
                Skip this step
              </Button>
              <div className="flex gap-3">
                <Button size="lg" variant="outline" onClick={back}>
                  Back
                </Button>
                <Button
                  size="lg"
                  className="flex-1"
                  onClick={() => finishSetup()}
                  disabled={saving || taxErrors.some(Boolean)}
                >
                  {saving ? "Saving…" : "Finish setup"}
                </Button>
              </div>
            </>
          )}

          {/* ─── Step 4: Invite your team ─── */}
          {step === 4 && (
            <>
              <p className="text-muted-foreground">
                Invite your first team members now so they can get started right away. You can add
                more people later in Settings.
              </p>

              <form
                method="post"
                onSubmit={inviteSubmit}
                className="flex flex-col gap-4 sm:flex-row sm:items-end"
              >
                <div className="flex-1">
                  <Field id="invite-email" label="Email">
                    <Input
                      id="invite-email"
                      type="email"
                      required
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                    />
                  </Field>
                </div>
                <div className="sm:w-44">
                  <Field id="invite-role" label="Role">
                    <select
                      id="invite-role"
                      className={selectClass}
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as Role)}
                    >
                      <option value="admin">Admin (co-manager)</option>
                      <option value="staff">Team member</option>
                    </select>
                  </Field>
                </div>
                <Button type="submit">Create invite link</Button>
              </form>

              {inviteLink ? (
                <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-4">
                  <p className="text-sm">
                    Send this link to them. It works once, for that email address, for 72 hours.
                    (Emailing invites from Mend arrives with email sending.)
                  </p>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={inviteLink}
                      aria-label="Invite link"
                      onFocus={(e) => e.target.select()}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        void navigator.clipboard.writeText(inviteLink).then(() => setCopied(true))
                      }
                    >
                      {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                </div>
              ) : null}

              <Button variant="ghost" className="self-start" onClick={skip}>
                Skip this step
              </Button>
              <div className="flex gap-3">
                <Button size="lg" variant="outline" onClick={back}>
                  Back
                </Button>
                <Button size="lg" className="flex-1" onClick={() => void done()}>
                  Go to your board
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
