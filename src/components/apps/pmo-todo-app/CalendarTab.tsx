"use client";

import { useState } from "react";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/notifications/toastStore";
import { monthGrid, monthLabel, shiftMonth } from "@/lib/pmo/pmoViews";
import type { PmoState } from "@/lib/pmo/types";
import { patchTodo } from "./api";
import { GUTTER_X, ScrollBody } from "./parts";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SHOWN_PER_DAY = 3;

/** A month of due dates. Click a to-do to open it; drag one to another day to change its due date. */
export function CalendarTab({
  state,
  onOpen,
  onSettled,
}: {
  state: PmoState;
  onOpen: (todoId: string) => void;
  onSettled: () => void;
}) {
  const [year, setYear] = useState(() => Number(state.today.slice(0, 4)));
  const [month, setMonth] = useState(() => Number(state.today.slice(5, 7)));
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const weeks = monthGrid(year, month, state.todos);

  const go = (delta: number) => {
    const next = shiftMonth(year, month, delta);
    setYear(next.year);
    setMonth(next.month);
  };

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
    <ScrollBody memoryKey="pmo-calendar" className={cn(GUTTER_X, "py-3")}>
      <div className="mb-3 flex items-center gap-2">
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
            setYear(Number(state.today.slice(0, 4)));
            setMonth(Number(state.today.slice(5, 7)));
          }}
        >
          Today
        </Button>
      </div>
      <div className="grid min-w-[44rem] grid-cols-7 gap-px" data-testid="calendar">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="text-ink-muted px-2 pb-1 text-[11.5px] font-bold uppercase"
          >
            {d}
          </div>
        ))}
        {weeks.flat().map((cell) => (
          <div
            key={cell.day}
            data-day={cell.day}
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
              "border-line min-h-24 border p-1.5",
              cell.inMonth ? "bg-surface-elevated" : "bg-chip opacity-70",
              cell.day === state.today && "ring-accent ring-2 ring-inset",
              over === cell.day && "bg-accent-soft",
            )}
          >
            <span className="text-ink-muted block text-right text-[11.5px] font-semibold">
              {Number(cell.day.slice(8))}
            </span>
            <ul className="flex flex-col gap-1">
              {cell.todos.slice(0, SHOWN_PER_DAY).map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    draggable
                    onDragStart={() => setDragging(t.id)}
                    onClick={() => onOpen(t.id)}
                    title={t.title}
                    className={cn(
                      "bg-accent-soft text-accent-ink w-full truncate rounded-[6px] px-1.5 py-0.5 text-left text-[11.5px] font-semibold",
                      cell.day < state.today &&
                        "text-red bg-[color-mix(in_srgb,var(--color-red)_18%,transparent)]",
                    )}
                  >
                    {t.title}
                  </button>
                </li>
              ))}
              {cell.todos.length > SHOWN_PER_DAY && (
                <li className="text-ink-muted px-1 text-[11px]">
                  +{cell.todos.length - SHOWN_PER_DAY} more
                </li>
              )}
            </ul>
          </div>
        ))}
      </div>
    </ScrollBody>
  );
}
