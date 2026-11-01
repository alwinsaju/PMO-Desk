"use client";

import { cn } from "@/lib/cn";
import type { TaskSchedule } from "@/lib/tasks/taskSchedule";
import { stripDays, stripRows, toggleWeekday } from "./scheduleStrip";
import type { Task } from "./types";

/** The next seven days, one row per workflow. A highlighted cell is a day it runs; click a day to
 *  turn it on (weekly), move it, or switch the schedule off. Monthly schedules show but can only
 *  be changed in the table below. */
export function WeekStrip({
  tasks,
  schedules,
  onChange,
}: {
  tasks: readonly Pick<Task, "id" | "displayName">[];
  schedules: readonly TaskSchedule[];
  onChange: (taskId: string, next: TaskSchedule | null) => void;
}) {
  const now = new Date();
  const days = stripDays(now);
  const rows = stripRows(
    tasks.map((t) => t.id),
    schedules,
    now,
  );
  return (
    <div
      className="border-line bg-card rounded-card overflow-x-auto border"
      data-testid="week-strip"
    >
      <table className="w-full min-w-[560px] border-collapse text-center">
        <caption className="sr-only">What runs in the next seven days</caption>
        <thead>
          <tr className="text-ink-muted">
            <th scope="col" className="w-[28%] px-4 py-2.5 text-left">
              <span className="sr-only">Workflow</span>
            </th>
            {days.map((d) => (
              <th
                key={d.day}
                scope="col"
                className={cn(
                  "px-1 py-2.5 text-[11.5px] font-bold tracking-[0.06em] uppercase",
                  d.isToday && "text-accent-ink",
                )}
              >
                {d.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const task = tasks[index];
            const schedule = schedules.find((s) => s.taskId === task.id) ?? null;
            const editable = !schedule || schedule.cadence === "weekly";
            return (
              <tr key={row.taskId} className="border-line border-t">
                <th
                  scope="row"
                  className="text-ink max-w-0 truncate px-4 py-2 text-left text-[13px] font-semibold"
                  title={task.displayName}
                >
                  {task.displayName}
                </th>
                {row.cells.map((cell, i) => (
                  <td key={cell.day} className="px-1 py-1.5">
                    <button
                      type="button"
                      aria-pressed={cell.runs}
                      disabled={!editable}
                      aria-label={`${task.displayName}, ${days[i].label === "Today" ? "today" : days[i].label}${cell.runs && row.time ? ` at ${row.time}` : ""}`}
                      onClick={() =>
                        onChange(task.id, toggleWeekday(schedule, task.id, cell.weekday))
                      }
                      className={cn(
                        "focus-visible:ring-focus h-8 w-full min-w-11 rounded-[8px] text-[11.5px] font-semibold tabular-nums outline-none focus-visible:ring-2",
                        cell.runs
                          ? "bg-accent-soft text-accent-ink"
                          : "bg-chip text-ink-faint enabled:hover:bg-chip-strong",
                        !editable && "cursor-default",
                      )}
                    >
                      {cell.runs ? (row.time ?? "") : ""}
                    </button>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
