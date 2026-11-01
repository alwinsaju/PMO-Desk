"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@/components/ui";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/notifications/toastStore";
import {
  CALENDAR_MODES,
  DOT_CLASS,
  SHOWN_PER_DAY,
  calendarWeeks,
  dayDots,
  periodLabel,
  shiftAnchor,
  stepLabel,
  type CalendarMode,
} from "@/lib/pmo/calendarView";
import { splitDayTodos, weekIndexOf } from "@/lib/pmo/pmoViews";
import { priorityTone } from "@/components/ui/chipLogic";
import type { PmoState, Todo } from "@/lib/pmo/types";
import { formatDate } from "@/lib/ui/dates";
import { patchTodo } from "./api";
import { FilterPill, GUTTER_X, STICKY_BAR, ScrollBody } from "./parts";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The due dates of a week or a month. It opens on the current month; click a
 *  to-do to open it, drag one to another day to change its due date. A coloured
 *  dot marks each to-do's priority, and a busy day's "+N more" opens a list. */
export function CalendarTab({
  state,
  onOpen,
  onSettled,
}: {
  state: PmoState;
  onOpen: (todoId: string) => void;
  onSettled: () => void;
}) {
  const [mode, setMode] = useState<CalendarMode>("month");
  // Any day inside the period shown.
  const [anchorDay, setAnchorDay] = useState(state.today);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // Counts presses of "Today", so pressing it again re-anchors the week.
  const [anchorTick, setAnchorTick] = useState(0);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const weeks = calendarWeeks(mode, anchorDay, state.todos);
  // Stepping within the same month in month mode shows the same period.
  const periodKey = mode === "month" ? anchorDay.slice(0, 7) : anchorDay;

  // Bring the current week to the top (below the sticky header) when a period is
  // shown; any other period starts at its first week.
  useLayoutEffect(() => {
    const index = weekIndexOf(weeks, state.today);
    rowRefs.current[Math.max(index, 0)]?.scrollIntoView({ block: "start" });
    // Only a change of period or a press of "Today" re-anchors, not each poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, periodKey, anchorTick]);

  const go = (delta: -1 | 1) => setAnchorDay(shiftAnchor(mode, anchorDay, delta));

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
      {/* The period and weekday headers stay in view while the weeks scroll under them. */}
      <div className={STICKY_BAR}>
        <div className={cn(GUTTER_X, "flex h-11 items-center gap-2")}>
          <Button
            variant="ghost"
            size="sm"
            aria-label={stepLabel(mode, -1)}
            onClick={() => go(-1)}
          >
            <CaretLeftIcon size={14} />
          </Button>
          <h3
            className="text-ink min-w-40 text-center text-[15px] font-bold"
            aria-live="polite"
          >
            {periodLabel(mode, anchorDay)}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            aria-label={stepLabel(mode, 1)}
            onClick={() => go(1)}
          >
            <CaretRightIcon size={14} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="ml-2"
            onClick={() => {
              setAnchorDay(state.today);
              setAnchorTick((tick) => tick + 1);
            }}
          >
            Today
          </Button>
          <div
            role="group"
            aria-label="Calendar view"
            className="ml-auto flex shrink-0 gap-1"
          >
            {CALENDAR_MODES.map(({ id, label }) => (
              <FilterPill key={id} active={mode === id} onClick={() => setMode(id)}>
                {label}
              </FilterPill>
            ))}
          </div>
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
                SHOWN_PER_DAY[mode],
                false,
              );
              const isToday = cell.day === state.today;
              const dots = dayDots(cell.todos);
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
                    "border-line border p-1",
                    mode === "week" ? "min-h-40" : "min-h-[4.5rem]",
                    cell.inMonth ? "bg-surface-elevated" : "bg-chip opacity-70",
                    isToday && "ring-accent ring-2 ring-inset",
                    over === cell.day && "bg-accent-soft",
                  )}
                >
                  <div className="mb-0.5 flex items-center justify-between gap-1">
                    <span
                      className={cn(
                        "inline-grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11.5px] font-semibold",
                        isToday ? "bg-accent text-accent-contrast" : "text-ink-muted",
                      )}
                    >
                      {Number(cell.day.slice(8))}
                    </span>
                    {dots.tones.length > 0 && (
                      <span
                        className="flex items-center gap-0.5"
                        title={`${cell.todos.length} to-do${cell.todos.length === 1 ? "" : "s"} due`}
                        aria-hidden
                      >
                        {dots.tones.map((tone, i) => (
                          <span
                            key={i}
                            className={cn("size-1.5 rounded-full", DOT_CLASS[tone])}
                          />
                        ))}
                        {dots.more > 0 && (
                          <span className="text-ink-muted text-[10px] leading-none font-semibold">
                            +{dots.more}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  <ul className="flex flex-col gap-0.5">
                    {shown.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          draggable
                          onDragStart={() => setDragging(t.id)}
                          onDragEnd={() => {
                            setDragging(null);
                            setOver(null);
                          }}
                          onClick={() => onOpen(t.id)}
                          title={t.title}
                          className={cn(
                            "focus-ring bg-accent-soft text-accent-ink flex w-full items-center gap-1.5 rounded-[6px] px-1.5 py-px text-left text-[11.5px] font-semibold",
                            cell.day < state.today &&
                              "text-red bg-[color-mix(in_srgb,var(--color-red)_18%,transparent)]",
                          )}
                        >
                          <PriorityDot priority={t.priority} />
                          <span className="min-w-0 truncate">{t.title}</span>
                        </button>
                      </li>
                    ))}
                    {hidden > 0 && (
                      <li>
                        <BusyDay
                          day={cell.day}
                          todos={cell.todos}
                          hidden={hidden}
                          today={state.today}
                          onOpen={onOpen}
                        />
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

function PriorityDot({ priority }: { priority: Todo["priority"] }) {
  const found = priorityTone(priority);
  return (
    <span
      role="img"
      aria-label={found?.label ?? "No priority"}
      className={cn("size-1.5 shrink-0 rounded-full", DOT_CLASS[found?.tone ?? "muted"])}
    />
  );
}

/** "+N more" for a day with more to-dos than fit: a popover with all of them. */
function BusyDay({
  day,
  todos,
  hidden,
  today,
  onOpen,
}: {
  day: string;
  todos: Todo[];
  hidden: number;
  today: string;
  onOpen: (todoId: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${hidden} more to-dos on ${formatDate(day)}`}
          className="text-ink-muted hover:text-ink focus-ring rounded px-1 text-[11px] font-semibold"
        >
          +{hidden} more
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex max-h-80 w-72 flex-col gap-2 p-3">
        <p className="text-ink text-[13px] font-bold">
          {formatDate(day)} · {todos.length} due
          {day < today && <span className="text-red font-semibold"> · overdue</span>}
        </p>
        <ul className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
          {todos.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onOpen(t.id)}
                className="hover:bg-chip focus-ring rounded-control text-ink flex w-full items-center gap-2 px-2 py-1.5 text-left text-[13px] font-medium"
              >
                <PriorityDot priority={t.priority} />
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
