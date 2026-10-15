import { useState } from "react";

import { Field, selectClass } from "@/components/app/Field";
import { PhoneInput } from "@/components/app/MaskedInputs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { focusFirstMissingField } from "@/lib/form";
import { friendlyDbError } from "@/lib/shop";

export type NewCustomerValues = {
  name: string;
  phone: string;
  email: string;
  channel: "sms" | "email";
};

const EMPTY: NewCustomerValues = { name: "", phone: "", email: "", channel: "sms" };

/**
 * The shared new-customer form: name*, and a phone or an email (at least one),
 * plus the preferred contact method. Used on the customers page now and reused
 * by the new-ticket dialog in PR 6b.
 */
export function NewCustomerForm({
  idPrefix,
  onSubmit,
  submitLabel = "Save customer",
}: {
  idPrefix: string;
  onSubmit: (values: NewCustomerValues) => Promise<void>;
  submitLabel?: string;
}) {
  const [values, setValues] = useState<NewCustomerValues>(EMPTY);
  const [fieldError, setFieldError] = useState<{
    field: "name" | "contact";
    text: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);
    setError(null);
    const missing = focusFirstMissingField([
      {
        id: `${idPrefix}-name`,
        ok: !!values.name.trim(),
        message: "Enter the customer's name.",
      },
      {
        id: `${idPrefix}-phone`,
        ok: !!(values.phone.trim() || values.email.trim()),
        message: "Enter a phone number or an email.",
      },
    ]);
    if (missing) {
      setFieldError({
        field: missing.id.endsWith("name") ? "name" : "contact",
        text: missing.message,
      });
      return;
    }
    setBusy(true);
    try {
      await onSubmit(values);
    } catch (e) {
      setError(friendlyDbError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form method="post" onSubmit={save} noValidate className="grid gap-4">
      <Field id={`${idPrefix}-name`} label="Name *">
        <Input
          id={`${idPrefix}-name`}
          value={values.name}
          maxLength={120}
          autoFocus
          onChange={(e) => {
            setValues({ ...values, name: e.target.value });
            setFieldError(null);
          }}
        />
        {fieldError?.field === "name" ? (
          <p className="text-sm text-danger">{fieldError.text}</p>
        ) : null}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${idPrefix}-phone`} label="Mobile phone *">
          <PhoneInput
            id={`${idPrefix}-phone`}
            value={values.phone}
            onValueChange={(phone) => {
              setValues({ ...values, phone });
              setFieldError(null);
            }}
          />
        </Field>
        <Field id={`${idPrefix}-email`} label="Email *">
          <Input
            id={`${idPrefix}-email`}
            type="email"
            value={values.email}
            onChange={(e) => {
              setValues({ ...values, email: e.target.value });
              setFieldError(null);
            }}
          />
        </Field>
      </div>
      {fieldError?.field === "contact" ? (
        <p className="-mt-2 text-sm text-danger">{fieldError.text}</p>
      ) : null}
      <p className="-mt-2 text-sm text-muted-foreground">A phone number, an email, or both.</p>
      <Field id={`${idPrefix}-channel`} label="Prefers">
        <select
          id={`${idPrefix}-channel`}
          className={selectClass}
          value={values.channel}
          onChange={(e) => setValues({ ...values, channel: e.target.value as "sms" | "email" })}
        >
          <option value="sms">Text message</option>
          <option value="email">Email</option>
        </select>
      </Field>
      {error ? <p className="text-danger">{error}</p> : null}
      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
