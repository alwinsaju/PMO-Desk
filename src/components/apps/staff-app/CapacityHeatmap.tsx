"use client";

import { useMemo } from "react";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { CapacityInput, CoverageRules } from "@/lib/staff/capacity";
import { addDays, dayName, formatRange, isWeekend, todayIso } from "@/lib/staff/dates";
import { capacityHeatmap, type HeatCell, type HeatLevel } from "@/lib/staff/insightsData";

const DAYS = 14;

const LEVEL_CLASS: Record<HeatLevel, string> = {
  0: "bg-chip/50 text-ink-faint",
  1: "bg-accent/15 text-ink",
  2: "bg-accent/30 text-ink",
  3: "bg-accent/50 text-ink",
  4: "bg-accent/75 text-accent-contrast",
};

const describe = (name: string, cell: HeatCell, need: number) =>
  cell.level === 0
    ? `${name}, ${cell.day}: nobody scheduled`
    : `${name}, ${cell.day}: ${cell.working} working${cell.onLeave ? `, ${cell.onLeave} on leave` : ""}${cell.short ? `, below the minimum of ${need}` : ""}`;

/** Team x day: how many people are working, darker for fuller days, red where a team is under its minimum. */
export function CapacityHeatmap({
  from,
  onFromChange,
  input,
  rules,
  selectedDay,
  onPick,
}: {
  from: string;
  onFromChange: (from: string) => void;
  input: CapacityInput;
  rules: CoverageRules;
  selectedDay: string;
  onPick: (day: string) => void;
}) {
  const today = todayIso();
  const map = useMemo(
    () => capacityHeatmap(from, DAYS, input, rules),
    [from, input, rules],
  );
  if (map.rows.length === 0) return null;

  return (
    <section aria-label="Capacity heatmap" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-ink text-[14px] font-bold">Who is working</h3>
        <span className="text-ink-muted text-[12.5px]">
          {formatRange(map.days[0], map.days[DAYS - 1])}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            aria-label="Earlier week"
            tooltip="Back a week"
            size="sm"
            onClick={() => onFromChange(addDays(from, -7))}
          >
            <CaretLeftIcon weight="bold" />
          </IconButton>
          <IconButton
            aria-label="Later week"
            tooltip="Forward a week"
            size="sm"
            onClick={() => onFromChange(addDays(from, 7))}
          >
            <CaretRightIcon weight="bold" />
          </IconButton>
        </div>
      </div>
      <div className="border-line bg-card rounded-card scroll-thin overflow-x-auto border">
        <table
          data-testid="capacity-heatmap"
          className="w-full min-w-[560px] border-separate border-spacing-[3px] p-1 text-center"
        >
          <thead>
            <tr>
              <th scope="col" className="w-[130px] min-w-[110px]">
                <span className="sr-only">Team</span>
              </th>
              {map.days.map((day) => (
                <th
                  key={day}
                  scope="col"
                  className={cn(
                    "rounded-control px-0 py-1 text-[11px] leading-tight font-semibold",
                    day === today ? "bg-accent-soft text-accent-ink" : "text-ink-muted",
                    isWeekend(day) && day !== today && "opacity-60",
                  )}
                >
                  <span className="block text-[10px] tracking-[0.06em] uppercase">
                    {dayName(day).slice(0, 3)}
                  </span>
                  {Number(day.slice(8))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {map.rows.map((row) => (
              <tr key={row.groupId}>
                <th
                  scope="row"
                  className="text-ink max-w-[160px] truncate px-2 text-left text-[12.5px] font-semibold"
                  title={row.name}
                >
                  {row.name}
                </th>
                {row.cells.map((cell) => (
                  <td key={cell.day} className="p-0">
                    <button
                      type="button"
                      aria-label={describe(row.name, cell, row.need)}
                      title={describe(row.name, cell, row.need)}
                      aria-pressed={cell.day === selectedDay}
                      onClick={() => onPick(cell.day)}
                      className={cn(
                        "rounded-control focus-ring h-8 w-full text-[12.5px] font-bold transition-[filter]",
                        "hover:brightness-95",
                        cell.short
                          ? "bg-red-soft text-red ring-red/50 ring-1"
                          : LEVEL_CLASS[cell.level],
                        cell.day === selectedDay &&
                          "outline-ink outline-2 -outline-offset-2",
                      )}
                    >
                      {cell.level === 0 ? "" : cell.working}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="text-ink-muted flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        <li className="flex items-center gap-1.5">
          Fewer
          {([1, 2, 3, 4] as const).map((level) => (
            <span
              key={level}
              className={cn("h-3.5 w-5 rounded-sm", LEVEL_CLASS[level])}
            />
          ))}
          more working
        </li>
        <li className="flex items-center gap-1.5">
          <span className="bg-red-soft ring-red/50 h-3.5 w-5 rounded-sm ring-1" />
          Below the team&apos;s minimum
        </li>
        <li className="flex items-center gap-1.5">
          <span className="bg-chip/50 h-3.5 w-5 rounded-sm" />
          Nobody scheduled
        </li>
        <li>Click a day to see its teams below.</li>
      </ul>
    </section>
  );
}
