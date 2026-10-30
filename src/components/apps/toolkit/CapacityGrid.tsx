"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { capacityGrid, weekStarts } from "@/lib/registers/capacity";
import { workDays } from "@/lib/registers/timesheets";
import { addDays, formatDayMonth, mondayOf } from "@/lib/staff/dates";
import type { TopProps } from "./RegisterApp";

const WEEKS = 8;

/** Who is allocated how much in each of the next weeks, against leave. Over 100% (or over what leave leaves) is red. */
export function CapacityGrid({ state, today, people, leave }: TopProps) {
  const [from, setFrom] = useState(() => mondayOf(today));
  const weeks = weekStarts(from, WEEKS);
  const leaveDays = (person: string, monday: string) => {
    const id = people.find((p) => p.name.toLowerCase() === person.toLowerCase())?.id;
    if (!id) return 0;
    return workDays(monday).filter((day) =>
      leave.some((l) => l.employeeId === id && l.startDate <= day && day <= l.endDate),
    ).length;
  };
  const rows = capacityGrid(state.items, weeks, leaveDays);
  const over = rows.reduce((n, r) => n + r.overWeeks, 0);

  return (
    <div className="mx-6 mb-3" data-testid="capacity-grid">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFrom(addDays(from, -7 * WEEKS))}
          aria-label="Earlier weeks"
        >
          ‹
        </Button>
        <Input
          type="date"
          value={from}
          onChange={(e) => e.target.value && setFrom(mondayOf(e.target.value))}
          aria-label="First week"
          className="w-40"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFrom(addDays(from, 7 * WEEKS))}
          aria-label="Later weeks"
        >
          ›
        </Button>
        <span
          className={`text-[13px] ${over > 0 ? "text-red font-semibold" : "text-ink-muted"}`}
          data-testid="capacity-over"
        >
          {over > 0
            ? `${over} person-week${over === 1 ? "" : "s"} over capacity`
            : "No one is over capacity"}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-ink-muted text-[13px]">
          Add allocations below to see the grid.
        </p>
      ) : (
        <div className="scroll-thin overflow-x-auto">
          <table className="border-collapse text-[12.5px]">
            <thead>
              <tr className="text-ink-muted text-[11px] font-bold uppercase">
                <th className="px-2 py-1 text-left">Person</th>
                {weeks.map((w) => (
                  <th key={w} className="px-2 py-1 text-center">
                    {formatDayMonth(w)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.person} data-testid="capacity-row">
                  <td className="text-ink px-2 py-1 font-semibold whitespace-nowrap">
                    {row.person}
                  </td>
                  {row.cells.map((cell) => (
                    <td
                      key={cell.week}
                      data-over={cell.over}
                      title={cell.projects.join(", ") || "Not allocated"}
                      className={`min-w-14 px-2 py-1 text-center ${cell.over ? "bg-red-soft text-red font-bold" : cell.percent > 0 ? "bg-success-soft text-ink" : "text-ink-faint"}`}
                    >
                      {cell.percent > 0 ? `${cell.percent}%` : "–"}
                      {cell.available < 100 && (
                        <span className="text-ink-muted block text-[10px]">
                          {cell.available}% free
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
