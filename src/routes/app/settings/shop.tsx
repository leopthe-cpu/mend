import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { useUnsavedChanges } from "@/lib/unsaved";
import { FormAlert } from "@/components/auth/AuthLayout";
import { Field, Panel, selectClass } from "@/components/app/Field";
import { LogoPanel } from "@/components/app/LogoPanel";
import { Button } from "@/components/ui/button";
import { PhoneInput } from "@/components/app/MaskedInputs";
import { WeeklyHoursEditor } from "@/components/app/WeeklyHoursEditor";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { friendlyDbError, roleAtLeast, TIME_ZONES } from "@/lib/shop";
import { defaultSchedule, scheduleToText, type WeeklySchedule } from "@/lib/hours";
import { getSupabase } from "@/lib/supabase";

export const Route = createFileRoute("/app/settings/shop")({
  component: ShopSettings,
});

function ShopSettings() {
  const { membership } = Route.useRouteContext();
  const router = useRouter();
  const shop = membership.shop;
  const canEdit = roleAtLeast(membership.role, "admin");
  const [schedule, setSchedule] = useState<WeeklySchedule>(
    shop.business_hours?.schedule ?? defaultSchedule(),
  );
  const existingHoursText =
    shop.business_hours?.text && !shop.business_hours?.schedule ? shop.business_hours.text : null;
  const [form, setForm] = useState({
    name: shop.name,
    address: shop.address ?? "",
    phone: shop.phone ?? "",
    email: shop.email ?? "",
    time_zone: shop.time_zone,
    currency: shop.currency,
    tax_registration_number: shop.tax_registration_number ?? "",
    terms_text: shop.terms_text ?? "",
    unclaimed_reminder_days: String(shop.unclaimed_reminder_days),
    quiet_hours_start: shop.quiet_hours_start.slice(0, 5),
    quiet_hours_end: shop.quiet_hours_end.slice(0, 5),
  });
  const [status, setStatus] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  // Unsaved-changes guard (decision 99): compare with what was last saved.
  const [savedState, setSavedState] = useState(() => JSON.stringify({ form, schedule }));
  useUnsavedChanges(canEdit && JSON.stringify({ form, schedule }) !== savedState, () => saveForm());
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await saveForm();
  }

  async function saveForm(): Promise<boolean> {
    const fail = (text: string) => {
      setStatus({ tone: "error", text });
      return false;
    };
    if (!form.name.trim()) return fail("The shop needs a name.");
    // Decision 76: texts identify the shop (CASL); the database refuses texts
    // without both.
    if (!form.address.trim() || form.phone.replace(/\D/g, "").length < 10)
      return fail(
        "Add the shop's address and phone. They identify your shop in the texts you send.",
      );
    const days = Number(form.unclaimed_reminder_days);
    if (!Number.isInteger(days) || days < 1 || days > 365)
      return fail("Reminder days must be a whole number from 1 to 365.");
    setSaving(true);
    setStatus(null);
    const { data, error } = await getSupabase()
      .from("shops")
      .update({
        name: form.name.trim(),
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim().toLowerCase() || null,
        business_hours: { text: scheduleToText(schedule), schedule },
        time_zone: form.time_zone,
        currency: form.currency,
        tax_registration_number: form.tax_registration_number.trim() || null,
        terms_text: form.terms_text.trim() || null,
        unclaimed_reminder_days: days,
        quiet_hours_start: form.quiet_hours_start,
        quiet_hours_end: form.quiet_hours_end,
      })
      .eq("id", shop.id)
      .select("id");
    setSaving(false);
    if (error) return fail(friendlyDbError(error));
    if (!data?.length) return fail("You don't have permission to change these settings.");
    setStatus({ tone: "info", text: "Saved." });
    setSavedState(JSON.stringify({ form, schedule }));
    await router.invalidate();
    return true;
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <LogoPanel shopId={shop.id} logoPath={shop.logo_path} canEdit={canEdit} />
      <form method="post" onSubmit={save} className="flex flex-col gap-6">
        {!canEdit ? <FormAlert tone="info">Only Admins can change shop settings.</FormAlert> : null}
        <fieldset disabled={!canEdit} className="flex flex-col gap-6">
          <Panel
            title="Shop profile"
            description="Shown on estimates, invoices, claim tags and customer messages."
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field id="name" label="Shop name">
                  <Input id="name" value={form.name} onChange={set("name")} maxLength={120} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field
                  id="address"
                  label="Address *"
                  hint={
                    <>
                      Shown with your phone on your public contact page,{" "}
                      <a
                        href={`/s/${shop.public_code}`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-4"
                      >
                        /s/{shop.public_code}
                      </a>
                      , linked from your first text to each customer.
                    </>
                  }
                >
                  <Input
                    id="address"
                    value={form.address}
                    onChange={set("address")}
                    maxLength={500}
                  />
                </Field>
              </div>
              <Field id="phone" label="Phone *">
                <PhoneInput
                  id="phone"
                  value={form.phone}
                  onValueChange={(phone) => setForm({ ...form, phone })}
                />
              </Field>
              <Field id="email" label="Email" hint="Customer replies to Mend emails go here.">
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={set("email")}
                  maxLength={254}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field id="hours" label="Shop hours" hint="Shown in 'your item is ready' messages.">
                  {existingHoursText ? (
                    <p className="mb-2 text-sm text-muted-foreground">
                      Your current hours: {existingHoursText}
                    </p>
                  ) : null}
                  <WeeklyHoursEditor value={schedule} onChange={setSchedule} id="hours" />
                </Field>
              </div>
              <Field id="tz" label="Time zone">
                <select
                  id="tz"
                  className={selectClass}
                  value={form.time_zone}
                  onChange={set("time_zone")}
                >
                  {TIME_ZONES.some((z) => z.value === form.time_zone) ? null : (
                    <option value={form.time_zone}>{form.time_zone}</option>
                  )}
                  {TIME_ZONES.map((z) => (
                    <option key={z.value} value={z.value}>
                      {z.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="currency" label="Currency">
                <select
                  id="currency"
                  className={selectClass}
                  value={form.currency}
                  onChange={set("currency")}
                >
                  <option value="CAD">CAD</option>
                  <option value="USD">USD</option>
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field
                  id="taxno"
                  label="Tax registration number"
                  hint="For example your GST/HST number. Printed on invoices."
                >
                  <Input
                    id="taxno"
                    value={form.tax_registration_number}
                    onChange={set("tax_registration_number")}
                    maxLength={60}
                  />
                </Field>
              </div>
            </div>
          </Panel>

          <Panel title="Terms" description="Customers accept these when you log their item.">
            <Field id="terms" label="Terms text">
              <Textarea
                id="terms"
                rows={6}
                value={form.terms_text}
                onChange={set("terms_text")}
                maxLength={10000}
                className="min-h-32 bg-surface-2 text-base"
              />
            </Field>
          </Panel>

          <Panel title="Notifications">
            <div className="grid gap-5 sm:grid-cols-3">
              <Field id="qs" label="Quiet hours start">
                <Input
                  id="qs"
                  type="time"
                  value={form.quiet_hours_start}
                  onChange={set("quiet_hours_start")}
                />
              </Field>
              <Field id="qe" label="Quiet hours end">
                <Input
                  id="qe"
                  type="time"
                  value={form.quiet_hours_end}
                  onChange={set("quiet_hours_end")}
                />
              </Field>
              <Field id="ur" label="Unclaimed reminder after (days)">
                <Input
                  id="ur"
                  inputMode="numeric"
                  value={form.unclaimed_reminder_days}
                  onChange={set("unclaimed_reminder_days")}
                />
              </Field>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Messages confirmed during quiet hours are sent at the next allowed time.
            </p>
          </Panel>
        </fieldset>
        {status ? <FormAlert tone={status.tone}>{status.text}</FormAlert> : null}
        {canEdit ? (
          <div>
            <Button type="submit" size="lg" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        ) : null}
      </form>
    </div>
  );
}
