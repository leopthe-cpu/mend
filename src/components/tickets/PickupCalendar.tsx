import { createContext, useContext, useEffect, useState, type ComponentProps } from "react";
import type { DayButton } from "react-day-picker";

import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { dateFromIso, isoFromDate } from "@/lib/intake";
import { getSupabase } from "@/lib/supabase";

// Pick-up date for a new ticket (UX plan v2, PR 6, decision 69): a month
// calendar where each day shows how many open tickets are already promised
// for it, as a white number on a grey circle (--count-badge, AA-checked in
// design-tokens.ts). Counts come from promised_date_counts (staff+).

// The day button is a component react-day-picker renders, so the counts reach
// it through context; a component defined inside PickupCalendar would be a
// new type on every render and remount every day (losing keyboard focus).
const CountsContext = createContext<Map<string, number>>(new Map());

function CountDayButton(props: ComponentProps<typeof DayButton>) {
  const count = useContext(CountsContext).get(isoFromDate(props.day.date));
  return (
    <CalendarDayButton {...props} className="relative">
      {props.children}
      {count ? (
        <>
          {/* opacity-100! beats the "[&>span]:opacity-70" on the shared day button. */}
          <span
            aria-hidden
            className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-count-badge px-1 text-[10px] leading-none font-semibold text-white opacity-100!"
          >
            {count}
          </span>
          <span className="sr-only">
            , {count} open ticket{count > 1 ? "s" : ""} due
          </span>
        </>
      ) : null}
    </CalendarDayButton>
  );
}

const COMPONENTS = { DayButton: CountDayButton };

export function PickupCalendar({
  shopId,
  today,
  value,
  onChange,
}: {
  shopId: string;
  /** The shop's local date (YYYY-MM-DD); earlier days can't be picked. */
  today: string;
  value: string;
  onChange: (iso: string) => void;
}) {
  const [month, setMonth] = useState(() => dateFromIso(value || today));
  const [counts, setCounts] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    // The visible grid, including the outside days of the weeks around it
    // (at most 6 + 31 + 6 days, under the function's two-month cap).
    const from = new Date(month.getFullYear(), month.getMonth(), 1 - 6);
    const to = new Date(month.getFullYear(), month.getMonth() + 1, 6);
    let stale = false;
    void getSupabase()
      .rpc("promised_date_counts", {
        p_shop_id: shopId,
        p_from: isoFromDate(from),
        p_to: isoFromDate(to),
      })
      .then(({ data }) => {
        if (stale) return;
        const rows = (data ?? []) as { day: string; open_tickets: number }[];
        // Counts are a hint; if they fail to load the calendar still works.
        setCounts(new Map(rows.map((r) => [r.day, Number(r.open_tickets)])));
      });
    return () => {
      stale = true;
    };
  }, [shopId, month]);

  return (
    <CountsContext.Provider value={counts}>
      <Calendar
        mode="single"
        selected={value ? dateFromIso(value) : undefined}
        onSelect={(d) => onChange(d ? isoFromDate(d) : "")}
        month={month}
        onMonthChange={setMonth}
        disabled={{ before: dateFromIso(today) }}
        components={COMPONENTS}
        className="rounded-md border border-input bg-surface-2 p-2 [--cell-size:2.5rem]"
      />
    </CountsContext.Provider>
  );
}
