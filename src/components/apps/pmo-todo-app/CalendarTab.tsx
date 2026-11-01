"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/notifications/toastStore";
import {
  monthGrid,
  monthLabel,
  monthOf,
  shiftMonth,
  splitDayTodos,
  weekIndexOf,
} from "@/lib/pmo/pmoViews";
import type { PmoState } from "@/lib/pmo/types";
import { patchTodo } from "./api";
import { GUTTER_X, STICKY_BAR, ScrollBody } from "./parts";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SHOWN_PER_DAY = 2;

/** A month of due dates. It opens on the current week; click a to-do to open it,
 *  drag one to another day to change its due date. */
export function CalendarTab({
  state,
  onOpen,
  onSettled,
}: {
  state: PmoState;
  onOpen: (todoId: string) => void;
  onSettled: () => void;
}) {
  const [{ year, month }, setShown] = useState(() => monthOf(state.today));
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  // Counts presses of "Today", so pressing it again re-anchors the week.
  const [anchorTick, setAnchorTick] = useState(0);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const weeks = monthGrid(year, month, state.todos);

  // Bring the current week to the top (below the sticky header) when this
  // month is shown; any other month starts at its first week.
  useLayoutEffect(() => {
    const index = weekIndexOf(weeks, state.today);
    rowRefs.current[Math.max(index, 0)]?.scrollIntoView({ block: "start" });
    // Only a change of month or a press of "Today" re-anchors, not each poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, anchorTick]);

  const go = (delta: number) => setShown(shiftMonth(year, month, delta));

  const drop = async (day: string) => {
    const todo = state.todos.find((t) => t.id === dragging);
    setDragging(null);
    setOver(null);
    if (!todo || todo.dueAt === day) return;
    const reply = await patchTodo(todo.id, { dueAt: day });
    toast(
      reply.ok
        ? { message: `Moved “${todo.title}” to ${day}.`, durationMs: 3000 }
        : { tone: "danger", message: reply.reason },
    );
    onSettled();
  };

  return (
    <ScrollBody>
      {/* Month and weekday headers stay in view while the weeks scroll under them. */}
      <div className={STICKY_BAR}>
        <div className={cn(GUTTER_X, "flex h-11 items-center gap-2")}>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Previous month"
            onClick={() => go(-1)}
          >
            <CaretLeftIcon size={14} />
          </Button>
          <h3
            className="text-ink min-w-40 text-center text-[15px] font-bold"
            aria-live="polite"
          >
            {monthLabel(year, month)}
          </h3>
          <Button variant="ghost" size="sm" aria-label="Next month" onClick={() => go(1)}>
            <CaretRightIcon size={14} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="ml-2"
            onClick={() => {
              setShown(monthOf(state.today));
              setAnchorTick((tick) => tick + 1);
            }}
          >
            Today
          </Button>
        </div>
        <div className={cn(GUTTER_X, "grid h-6 grid-cols-7 gap-px")}>
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="text-ink-muted px-2 text-[11.5px] font-bold uppercase"
            >
              {d}
            </div>
          ))}
        </div>
      </div>
      <div className={cn(GUTTER_X, "flex flex-col gap-px py-2")} data-testid="calendar">
        {weeks.map((week, index) => (
          <div
            key={week[0].day}
            ref={(el) => {
              rowRefs.current[index] = el;
            }}
            className="grid scroll-mt-17 grid-cols-7 gap-px"
          >
            {week.map((cell) => {
              const { shown, hidden } = splitDayTodos(
                cell.todos,
                SHOWN_PER_DAY,
                expandedDay === cell.day,
              );
              const isToday = cell.day === state.today;
              return (
                <div
                  key={cell.day}
                  data-day={cell.day}
                  aria-current={isToday ? "date" : undefined}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(cell.day);
                  }}
                  onDragLeave={() => setOver((d) => (d === cell.day ? null : d))}
                  onDrop={(e) => {
                    e.preventDefault();
                    void drop(cell.day);
                  }}
                  className={cn(
                    "border-line min-h-[4.5rem] border p-1",
                    cell.inMonth ? "bg-surface-elevated" : "bg-chip opacity-70",
                    isToday && "ring-accent ring-2 ring-inset",
                    over === cell.day && "bg-accent-soft",
                  )}
                >
                  <span
                    className={cn(
                      "mb-0.5 inline-grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11.5px] font-semibold",
                      isToday ? "bg-accent text-accent-contrast" : "text-ink-muted",
                    )}
                  >
                    {Number(cell.day.slice(8))}
                  </span>
                  <ul className="flex flex-col gap-0.5">
                    {shown.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          draggable
                          onDragStart={() => setDragging(t.id)}
                          onClick={() => onOpen(t.id)}
                          title={t.title}
                          className={cn(
                            "bg-accent-soft text-accent-ink w-full truncate rounded-[6px] px-1.5 py-px text-left text-[11.5px] font-semibold",
                            cell.day < state.today &&
                              "text-red bg-[color-mix(in_srgb,var(--color-red)_18%,transparent)]",
                          )}
                        >
                          {t.title}
                        </button>
                      </li>
                    ))}
                    {(hidden > 0 || expandedDay === cell.day) && (
                      <li>
                        <button
                          type="button"
                          aria-expanded={expandedDay === cell.day}
                          onClick={() =>
                            setExpandedDay(expandedDay === cell.day ? null : cell.day)
                          }
                          className="text-ink-muted hover:text-ink focus-visible:ring-focus rounded px-1 text-[11px] font-semibold outline-none focus-visible:ring-2"
                        >
                          {hidden > 0 ? `+${hidden} more` : "Show less"}
                        </button>
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </ScrollBody>
  );
}
