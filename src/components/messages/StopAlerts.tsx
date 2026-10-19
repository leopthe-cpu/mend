import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { getSupabase } from "@/lib/supabase";

// Board banner: customers who replied STOP in the last 7 days (decision 77),
// so the shop calls or emails them instead of waiting for texts that won't
// go out. Dismissing hides a customer on this device only (a convenience,
// not a record); the ticket page and timeline keep showing it.

const DAYS = 7;
const STORE = "mend:stopAlertsDismissed";

type Row = { id: string; name: string; sms_opted_out_at: string };

function readDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function StopAlerts({ shopId, timeZone }: { shopId: string; timeZone: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);

  useEffect(() => {
    let stale = false;
    const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
    void getSupabase()
      .from("customers")
      .select("id, name, sms_opted_out_at")
      .eq("shop_id", shopId)
      .eq("sms_opt_out_source", "stop")
      .gte("sms_opted_out_at", since)
      .order("sms_opted_out_at", { ascending: false })
      .limit(10)
      .then(({ data }) => {
        if (!stale) setRows((data ?? []) as Row[]);
      });
    return () => {
      stale = true;
    };
  }, [shopId]);

  // A key per opt-out (customer + time), so a later STOP shows again.
  const key = (r: Row) => `${r.id}@${r.sms_opted_out_at}`;
  const visible = rows.filter((r) => !dismissed.includes(key(r)));
  if (!visible.length) return null;

  function dismiss(r: Row) {
    const next = [...dismissed, key(r)].slice(-50);
    setDismissed(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {
      // Private mode or storage blocked: it just shows again next time.
    }
  }

  const day = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone, month: "short", day: "numeric" }).format(
      new Date(iso),
    );

  return (
    <div className="mb-4 rounded-[1.75rem] bg-card p-4" role="status">
      <p className="font-semibold">Texts turned off</p>
      <p className="text-sm text-muted-foreground">
        These customers replied STOP. Texts to them won't be sent; call or email them instead.
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {visible.map((r) => (
          <li key={key(r)} className="flex items-center justify-between gap-3">
            <span>
              <Link
                to="/app/customers/$customerId"
                params={{ customerId: r.id }}
                className="font-medium underline underline-offset-4"
              >
                {r.name}
              </Link>{" "}
              <span className="text-sm text-muted-foreground">
                replied STOP on {day(r.sms_opted_out_at)}
              </span>
            </span>
            <button
              type="button"
              aria-label={`Dismiss ${r.name}`}
              className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
              onClick={() => dismiss(r)}
            >
              <X className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
