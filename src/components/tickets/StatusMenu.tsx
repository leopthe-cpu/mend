import { selectClass } from "@/components/app/Field";
import type { Status } from "@/lib/tickets";
import { cn } from "@/lib/utils";

// Tap/keyboard alternative to dragging (spec §7.3).
export function StatusMenu({
  statuses,
  value,
  onChange,
  label,
  className,
  id,
}: {
  id?: string;
  statuses: Status[];
  value: string;
  onChange: (statusId: string) => void;
  label: string;
  className?: string;
}) {
  return (
    <select
      id={id}
      aria-label={label}
      className={cn(selectClass, className)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {statuses.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
