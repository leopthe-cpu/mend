"use client";

import { CalendarDays } from "lucide-react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type DateRangeValue = { from: string; to: string };

function toDate(iso: string): Date | undefined {
  return iso ? new Date(`${iso}T00:00:00`) : undefined;
}

function toIso(d: Date): string {
  return d.toLocaleDateString("en-CA");
}

/** One date-range field instead of two separate date inputs (UX plan PR 5). */
export function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected: DateRange = { from: toDate(value.from), to: toDate(value.to) };
  const label = value.from || value.to ? `${value.from || "…"} → ${value.to || "…"}` : "Any date";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2 font-normal">
          <CalendarDays /> {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="range"
          selected={selected}
          {...(selected.from ? { defaultMonth: selected.from } : {})}
          numberOfMonths={1}
          onSelect={(range) => {
            onChange({
              from: range?.from ? toIso(range.from) : "",
              to: range?.to ? toIso(range.to) : "",
            });
            if (range?.from && range?.to) setOpen(false);
          }}
        />
        <div className="flex justify-end border-t border-border p-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange({ from: "", to: "" });
              setOpen(false);
            }}
          >
            Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
