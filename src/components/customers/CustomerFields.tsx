import { Field, selectClass } from "@/components/app/Field";
import { PhoneInput } from "@/components/app/MaskedInputs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CustomerFormValues } from "@/lib/customerForm";

/** Name, phone, email, channel and notes; used on the customer page and in EditCustomerDialog. */
export function CustomerFields({
  value: form,
  onChange,
  idPrefix = "c",
}: {
  value: CustomerFormValues;
  onChange: (v: CustomerFormValues) => void;
  idPrefix?: string;
}) {
  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field id={id("name")} label="Name">
          <Input
            id={id("name")}
            value={form.name}
            onChange={(e) => onChange({ ...form, name: e.target.value })}
            maxLength={120}
          />
        </Field>
      </div>
      <Field id={id("phone")} label="Mobile phone">
        <PhoneInput
          id={id("phone")}
          value={form.phone}
          onValueChange={(phone) => onChange({ ...form, phone })}
        />
      </Field>
      <Field id={id("email")} label="Email">
        <Input
          id={id("email")}
          type="email"
          value={form.email}
          onChange={(e) => onChange({ ...form, email: e.target.value })}
        />
      </Field>
      <Field id={id("channel")} label="Send updates by">
        <select
          id={id("channel")}
          className={selectClass}
          value={form.channel}
          onChange={(e) => onChange({ ...form, channel: e.target.value as "sms" | "email" })}
        >
          <option value="sms">Text message</option>
          <option value="email">Email</option>
        </select>
      </Field>
      <div className="sm:col-span-2">
        <Field id={id("notes")} label="Notes">
          <Textarea
            id={id("notes")}
            rows={3}
            className="bg-surface-2 text-base"
            value={form.notes}
            onChange={(e) => onChange({ ...form, notes: e.target.value })}
            maxLength={2000}
          />
        </Field>
      </div>
    </div>
  );
}
