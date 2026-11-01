"use client";

import { useState } from "react";
import { CalendarBlankIcon, CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import {
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  addMonths,
  formatDate,
  formatMonth,
  isIsoDate,
  monthStart,
  monthWeeks,
  todayIso,
} from "@/lib/staff/dates";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/**
 * A day picker in the app's own style: a button showing "30 Oct 2026" that opens a month
 * calendar. Used instead of the browser's date input, which looks different in every
 * theme. `value` and `onChange` are yyyy-mm-dd.
 */
export function DateField({
  value,
  onChange,
  label,
  className,
}: {
  value: string;
  onChange: (iso: string) => void;
  /** Names the control for screen readers, e.g. "Day". */
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => monthStart(value));
  const today = todayIso();
  const valid = isIsoDate(value);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setMonth(monthStart(valid ? value : today));
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-label={`${label}: ${valid ? formatDate(value) : "no date"}. Choose a date`}
          className={cn("w-44 justify-start gap-2 font-semibold", className)}
        >
          <CalendarBlankIcon size={16} weight="bold" />
          {valid ? formatDate(value) : "Choose a date"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[17.5rem] p-3">
        <div className="mb-2 flex items-center justify-between">
          <IconButton
            aria-label="Previous month"
            size="sm"
            onClick={() => setMonth(addMonths(month, -1))}
          >
            <CaretLeftIcon weight="bold" />
          </IconButton>
          <p className="text-ink text-[13.5px] font-bold" aria-live="polite">
            {formatMonth(month)}
          </p>
          <IconButton
            aria-label="Next month"
            size="sm"
            onClick={() => setMonth(addMonths(month, 1))}
          >
            <CaretRightIcon weight="bold" />
          </IconButton>
        </div>
        <table className="w-full table-fixed border-collapse text-center">
          <thead>
            <tr>
              {WEEKDAYS.map((d) => (
                <th key={d} scope="col" className="text-ink-muted pb-1 text-[11px]">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {monthWeeks(month).map((week, row) => (
              <tr key={row}>
                {week.map((day, col) => (
                  <td key={col} className="p-0.5">
                    {day && (
                      <button
                        type="button"
                        aria-label={formatDate(day)}
                        aria-pressed={day === value}
                        onClick={() => {
                          onChange(day);
                          setOpen(false);
                        }}
                        className={cn(
                          "transition-ui focus-ring h-8 w-full rounded-lg text-[13px]",
                          day === value
                            ? "bg-accent text-accent-contrast font-bold"
                            : "text-ink hover:bg-chip-strong",
                          day === today &&
                            day !== value &&
                            "text-accent-ink font-bold shadow-[inset_0_0_0_1px_var(--color-accent)]",
                        )}
                      >
                        {Number(day.slice(8))}
                      </button>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(today);
              setOpen(false);
            }}
          >
            Today
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
