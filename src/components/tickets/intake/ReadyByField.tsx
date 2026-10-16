import { CalendarDays } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dateFromIso, isoFromDate } from "@/lib/intake";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { PickupCalendar } from "../PickupCalendar";

const DAYS = 6;

/**
 * "Ready by" for the new-ticket form (decision 78 redesign): the next six days
 * as buttons, each with how many open tickets are already due that day
 * (promised_date_counts), plus "Other date" for the full calendar. Pressing the
 * chosen day again clears it; the date stays optional.
 */
export function ReadyByField({
  shopId,
  today,
  value,
  onChange,
}: {
  shopId: string;
  today: string;
  value: string;
  onChange: (iso: string) => void;
}) {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [pickOpen, setPickOpen] = useState(false);

  const days = useMemo(() => {
    const start = dateFromIso(today);
    return Array.from({ length: DAYS }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return { iso: isoFromDate(d), date: d, i };
    });
  }, [today]);

  useEffect(() => {
    let stale = false;
    void getSupabase()
      .rpc("promised_date_counts", {
        p_shop_id: shopId,
        p_from: days[0]!.iso,
        p_to: days[DAYS - 1]!.iso,
      })
      .then(({ data }) => {
        if (stale) return;
        const rows = (data ?? []) as { day: string; open_tickets: number }[];
        setCounts(new Map(rows.map((r) => [r.day, Number(r.open_tickets)])));
      });
    return () => {
      stale = true;
    };
  }, [shopId, days]);

  const label = (d: Date, i: number) =>
    i === 0
      ? "Today"
      : i === 1
        ? "Tomorrow"
        : new Intl.DateTimeFormat("en-CA", { weekday: "short", day: "numeric" }).format(d);
  const other = value && !days.some((d) => d.iso === value) ? value : "";
  const chip = (on: boolean) =>
    cn(
      "flex min-h-14 shrink-0 flex-col items-start justify-center gap-0.5 rounded-md border px-3 text-left",
      on
        ? "border-primary bg-primary text-primary-foreground"
        : "border-input bg-surface-2 hover:bg-accent",
    );

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Ready by</h3>
      <div
        role="group"
        aria-label="Ready by"
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap"
      >
        {days.map((d) => {
          const on = value === d.iso;
          const n = counts.get(d.iso) ?? 0;
          return (
            <button
              key={d.iso}
              type="button"
              aria-pressed={on}
              className={chip(on)}
              onClick={() => onChange(on ? "" : d.iso)}
            >
              <span className="font-semibold whitespace-nowrap">{label(d.date, d.i)}</span>
              <span
                className={cn("text-xs", on ? "text-primary-foreground" : "text-muted-foreground")}
              >
                {n ? `${n} due` : "none due"}
              </span>
            </button>
          );
        })}
        {other ? (
          <button type="button" aria-pressed className={chip(true)} onClick={() => onChange("")}>
            <span className="font-semibold whitespace-nowrap">
              {new Intl.DateTimeFormat("en-CA", {
                weekday: "short",
                month: "short",
                day: "numeric",
              }).format(dateFromIso(other))}
            </span>
            <span className="text-xs text-primary-foreground">Press to clear</span>
          </button>
        ) : null}
        <Popover open={pickOpen} onOpenChange={setPickOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex min-h-14 shrink-0 items-center gap-2 rounded-md border border-input bg-surface-2 px-3 hover:bg-accent"
            >
              <CalendarDays aria-hidden className="size-5" />
              <span className="whitespace-nowrap">Other date</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <PickupCalendar
              shopId={shopId}
              today={today}
              value={value}
              onChange={(iso) => {
                onChange(iso);
                if (iso) setPickOpen(false);
              }}
              className="rounded-none border-0"
            />
          </PopoverContent>
        </Popover>
      </div>
      <p className="text-xs text-muted-foreground">
        &ldquo;Due&rdquo; is how many open tickets are already promised for that day.
      </p>
    </div>
  );
}
