import { Input } from "@/components/ui/input";
import { selectClass } from "@/components/app/Field";
import type { CustomField } from "@/lib/tickets";

export function CustomFieldInput({
  field,
  value,
  onChange,
  id,
}: {
  field: CustomField;
  value: string | number | undefined;
  onChange: (v: string | number | undefined) => void;
  id: string;
}) {
  if (field.field_type === "select") {
    return (
      <select
        id={id}
        className={selectClass}
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">Choose…</option>
        {field.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (field.field_type === "number") {
    return (
      <Input
        id={id}
        inputMode="decimal"
        value={value === undefined ? "" : String(value)}
        onChange={(e) => {
          const raw = e.target.value.trim();
          onChange(raw === "" ? undefined : Number.isNaN(Number(raw)) ? raw : Number(raw));
        }}
      />
    );
  }
  return (
    <Input
      id={id}
      type={field.field_type === "date" ? "date" : "text"}
      maxLength={500}
      value={(value as string) ?? ""}
      onChange={(e) => onChange(e.target.value || undefined)}
    />
  );
}
