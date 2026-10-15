import { createContext, useContext, useEffect, useState, type ComponentProps } from "react";
import type { DayButton } from "react-day-picker";

import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { dateFromIso, isoFromDate } from "@/lib/intake";
import { getSupabase } from "@/lib/supabase";

// Pick-up date for a new ticket (UX plan v2, PR 6, decision 69): a month
// calendar where each day shows how many open tickets are already promised
// for it, as a white number on a grey circle (--count-badge, AA-checked in
// design-tokens.ts). Counts come from promised_date_counts (staff+).
// PR 6b (15 Oct): accepts an optional className so it can be embedded inside
// a Popover (the caller removes the border).

const CountsContext = createContext<Map<string, number>>(new Map());

function CountDayButton(props: ComponentProps<typeof DayButton>) {
  const count = useContext(CountsContext).get(isoFromDate(props.day.date));
  return (
    <CalendarDayButton {...props} className="relative">
      {props.children}
      {count ? (
        <>
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
  className,
}: {
  shopId: string;
  today: string;
  value: string;
  onChange: (iso: string) => void;
  className?: string;
}) {
  const [month, setMonth] = useState(() => dateFromIso(value || today));
  const [counts, setCounts] = useState<Map<string, number>>(new Map());

  useEffect(() => {
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
        {...(className ? { className } : {})}
      />
    </CountsContext.Provider>
  );
}
