import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { Field, Panel, selectClass } from "@/components/app/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { friendlyDbError, roleAtLeast, TIME_ZONES } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";

export const Route = createFileRoute("/app/settings/shop")({
  component: ShopSettings,
});

function ShopSettings() {
  const { membership } = Route.useRouteContext();
  const router = useRouter();
  const shop = membership.shop;
  const canEdit = roleAtLeast(membership.role, "admin");
  const [form, setForm] = useState({
    name: shop.name,
    address: shop.address ?? "",
    phone: shop.phone ?? "",
    email: shop.email ?? "",
    hours: shop.business_hours?.text ?? "",
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
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return setStatus({ tone: "error", text: "The shop needs a name." });
    const days = Number(form.unclaimed_reminder_days);
    if (!Number.isInteger(days) || days < 1 || days > 365)
      return setStatus({
        tone: "error",
        text: "Reminder days must be a whole number from 1 to 365.",
      });
    setSaving(true);
    setStatus(null);
    const { data, error } = await getSupabase()
      .from("shops")
      .update({
        name: form.name.trim(),
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim().toLowerCase() || null,
        business_hours: form.hours.trim() ? { text: form.hours.trim() } : {},
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
    if (error) return setStatus({ tone: "error", text: friendlyDbError(error) });
    if (!data?.length)
      return setStatus({
        tone: "error",
        text: "You don't have permission to change these settings.",
      });
    setStatus({ tone: "info", text: "Saved." });
    await router.invalidate();
  }

  return (
    <form method="post" onSubmit={save} className="flex max-w-2xl flex-col gap-6">
      {!canEdit ? (
        <FormAlert tone="info">Only the Owner and Admins can change shop settings.</FormAlert>
      ) : null}
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
              <Field id="address" label="Address">
                <Input
                  id="address"
                  value={form.address}
                  onChange={set("address")}
                  maxLength={500}
                />
              </Field>
            </div>
            <Field id="phone" label="Phone">
              <Input
                id="phone"
                type="tel"
                value={form.phone}
                onChange={set("phone")}
                maxLength={40}
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
              <Field id="hours" label="Pickup hours" hint="Used for {pickup_hours} in messages.">
                <Input id="hours" value={form.hours} onChange={set("hours")} maxLength={200} />
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
  );
}
