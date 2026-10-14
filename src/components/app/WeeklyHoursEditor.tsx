import { selectClass } from "@/components/app/Field";
import { cn } from "@/lib/utils";
import { DAY_KEYS, formatHourLabel, type DayKey, type WeeklySchedule } from "@/lib/hours";

const DAY_LABELS: Record<DayKey, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

/**
 * Seven rows (Mon–Sun): open/closed checkbox plus open and close times.
 * Used in setup and Settings → Shop. The parent stores the schedule in
 * shops.business_hours.schedule and also saves business_hours.text.
 */
export function WeeklyHoursEditor({
  value,
  onChange,
  id,
}: {
  value: WeeklySchedule;
  onChange: (value: WeeklySchedule) => void;
  id?: string;
}) {
  const byDay = new Map(value.map((d) => [d.day, d]));

  function setDay(day: DayKey, patch: Partial<(typeof value)[number]>) {
    onChange(
      value.map((d) => (d.day === day ? { ...d, ...patch } : d)),
    );
  }

  const timeInvalid = (day: DayKey) => {
    const d = byDay.get(day);
    if (!d?.open) return false;
    return d.opens >= d.closes;
  };

  return (
    <div className="flex flex-col gap-2" id={id}>
      {/* Header: hidden on phones */}
      <div className="hidden grid-cols-[5rem_1fr_1fr] items-center gap-3 px-1 text-sm font-medium text-muted-foreground sm:grid">
        <span>Day</span>
        <span>Opens</span>
        <span>Closes</span>
      </div>
      {DAY_KEYS.map((day) => {
        const d = byDay.get(day);
        const invalid = timeInvalid(day);
        return (
          <div
            key={day}
            className={cn(
              "flex flex-col gap-2 rounded-md border border-border px-3 py-2 sm:grid sm:grid-cols-[5rem_1fr_1fr] sm:items-center sm:gap-3",
              !d?.open && "opacity-60",
            )}
          >
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                className="size-5"
                checked={d?.open ?? false}
                onChange={(e) =>
                  setDay(day, {
                    open: e.target.checked,
                    ...(e.target.checked && (!d?.opens || !d?.closes)
                      ? { opens: d?.opens ?? "09:00", closes: d?.closes ?? "17:00" }
                      : {}),
                  })
                }
              />
              {DAY_LABELS[day]}
            </label>
            <div className="flex gap-2">
              <select
                aria-label={`${DAY_LABELS[day]} opens`}
                className={cn(selectClass, invalid && "border-danger")}
                value={d?.opens ?? "09:00"}
                disabled={!d?.open}
                onChange={(e) => setDay(day, { opens: e.target.value })}
              >
                {HOUR_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <select
                aria-label={`${DAY_LABELS[day]} closes`}
                className={cn(selectClass, invalid && "border-danger")}
                value={d?.closes ?? "17:00"}
                disabled={!d?.open}
                onChange={(e) => setDay(day, { closes: e.target.value })}
              >
                {HOUR_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            {invalid ? (
              <p className="text-sm text-danger sm:hidden">Closes must be after opens.</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

const HOUR_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  const m = i % 2 === 0 ? "00" : "30";
  return { value: `${h}:${m}`, label: formatHourLabel(`${h}:${m}`) };
});