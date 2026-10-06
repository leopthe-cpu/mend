import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { PageHeader } from "@/components/app/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabase } from "@/lib/supabase";
import { friendlyDbError, roleAtLeast, TIME_ZONES, VERTICALS, type Vertical } from "@/lib/shop";
import { cn } from "@/lib/utils";

// Finish setting up, inside the app (decision 53). The shop already exists
// with defaults; this saves the Owner's answers in one server call
// (finish_shop_setup) and can be left for later at any step. Once finished,
// changes go through Settings.
export const Route = createFileRoute("/app/setup")({
  beforeLoad: ({ context }) => {
    if (context.membership.shop.setup_completed_at) throw redirect({ to: "/app/settings/shop" });
  },
  head: () => ({ meta: [{ title: "Finish setting up · Mend" }] }),
  component: Setup,
});

type TaxRow = { name: string; rate: string };
const STEPS = ["Names", "Your trade", "Location", "Taxes"] as const;

function Setup() {
  const { membership } = Route.useRouteContext();
  const shop = membership.shop;
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [shopName, setShopName] = useState(shop.name);
  const [fullName, setFullName] = useState("");
  const [vertical, setVertical] = useState<Vertical>(shop.vertical);
  const [country, setCountry] = useState<"CA" | "US">(shop.country);
  const [timeZone, setTimeZone] = useState(shop.time_zone);
  const [address, setAddress] = useState(shop.address ?? "");
  const [phone, setPhone] = useState(shop.phone ?? "");
  const [hours, setHours] = useState(shop.business_hours?.text ?? "");
  const [taxes, setTaxes] = useState<TaxRow[]>([{ name: "", rate: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!roleAtLeast(membership.role, "admin")) {
    return (
      <>
        <PageHeader title="Finish setting up" />
        <p className="max-w-xl text-muted-foreground">
          Your shop's owner is still setting things up. You can start using Mend in the meantime.
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

  async function finish() {
    if (taxErrors.some(Boolean)) return;
    if (!shopName.trim()) {
      setStep(0);
      return setError("The shop needs a name.");
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
      p_business_hours: hours.trim() ? { text: hours.trim() } : {},
      p_tax_rates: taxes
        .filter((t) => t.name.trim() && t.rate.trim())
        .map((t) => ({ name: t.name.trim(), rate: Number(t.rate) })),
    });
    setSaving(false);
    if (error) return setError(friendlyDbError(error));
    // Navigating re-runs the /app guard, which reloads the shop (and hides the
    // setup card). A separate router.invalidate() here raced the navigation
    // and aborted that request.
    await navigate({ to: "/app/board", replace: true });
  }

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

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

        <section className="mt-6 flex flex-col gap-5 rounded-lg border border-border bg-card p-6">
          {error ? <FormAlert tone="error">{error}</FormAlert> : null}

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
              <Button size="lg" onClick={next}>
                Continue
              </Button>
            </>
          )}

          {step === 1 && (
            <>
              <fieldset className="flex flex-col gap-3">
                <legend className="mb-2 font-medium">What do you repair?</legend>
                {VERTICALS.map((v) => (
                  <label
                    key={v.value}
                    className={cn(
                      "flex min-h-14 cursor-pointer items-center gap-3 rounded-md border border-input px-4 py-3 transition-colors",
                      vertical === v.value ? "border-primary bg-surface-2" : "hover:bg-surface-2",
                    )}
                  >
                    <input
                      type="radio"
                      name="vertical"
                      value={v.value}
                      checked={vertical === v.value}
                      onChange={() => setVertical(v.value)}
                      className="size-5 accent-[var(--color-primary)]"
                    />
                    <span className="flex flex-col">
                      <span className="font-medium">{v.label}</span>
                      <span className="text-sm text-muted-foreground">{v.hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <p className="text-sm text-muted-foreground">
                We'll set up matching board columns, ticket fields and a starter price list. You can
                change all of it later in Settings. The trade itself can only change before your
                first ticket.
              </p>
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

          {step === 2 && (
            <>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 font-medium">Country</legend>
                <div className="flex flex-col gap-3 sm:flex-row">
                  {(["CA", "US"] as const).map((c) => (
                    <label
                      key={c}
                      className={cn(
                        "flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border border-input",
                        country === c && "border-primary bg-surface-2",
                      )}
                    >
                      <input
                        type="radio"
                        name="country"
                        checked={country === c}
                        onChange={() => setCountry(c)}
                        className="size-4"
                      />
                      {c === "CA" ? "Canada (CAD)" : "United States (USD)"}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="flex flex-col gap-2">
                <Label htmlFor="tz">Time zone</Label>
                <select
                  id="tz"
                  value={timeZone}
                  onChange={(e) => setTimeZone(e.target.value)}
                  className="h-11 rounded-md border border-input bg-surface-2 px-3 text-base"
                >
                  {TIME_ZONES.map((z) => (
                    <option key={z.value} value={z.value}>
                      {z.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  autoComplete="street-address"
                  maxLength={500}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="phone">Shop phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                  maxLength={40}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="hours">Pickup hours</Label>
                <Input
                  id="hours"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  placeholder="Mon–Fri 10am–6pm, Sat 10am–4pm"
                  maxLength={200}
                />
                <p className="text-sm text-muted-foreground">
                  Shown in "your item is ready" messages.
                </p>
              </div>
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
                  <Plus /> Add another tax
                </Button>
              ) : null}
              <div className="flex gap-3">
                <Button size="lg" variant="outline" onClick={back}>
                  Back
                </Button>
                <Button
                  size="lg"
                  className="flex-1"
                  onClick={finish}
                  disabled={saving || taxErrors.some(Boolean)}
                >
                  {saving ? "Saving…" : "Finish setup"}
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
