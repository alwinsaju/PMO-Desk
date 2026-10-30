"use client";

import { useState } from "react";
import { Chip, GUTTER_X, PanelMessage, ScrollBody } from "./parts";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/notifications/toastStore";
import {
  BOARD_COLUMNS,
  boardColumns,
  dropPatch,
  type BoardColumn,
} from "@/lib/pmo/pmoViews";
import type { PmoState, Todo } from "@/lib/pmo/types";
import { patchTodo } from "./api";
import { formatDay } from "./queueView";

const PRIORITY_BAR: Record<Todo["priority"], string> = {
  high: "bg-[#e0584d]",
  normal: "bg-[#d29a2c]",
  low: "bg-[#5a93e0]",
};

/** The to-dos as columns: To do, Waiting, Snoozed, Done. Drag a card to Done to close it, or back to
 *  To do to reopen it and clear waiting or a snooze. Waiting and Snoozed need details, so they say where to set them. */
export function BoardTab({
  state,
  onOpen,
  onSettled,
}: {
  state: PmoState;
  onOpen: (todoId: string) => void;
  onSettled: () => void;
}) {
  const now = new Date(state.serverTime);
  const columns = boardColumns(state.todos, now);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<BoardColumn | null>(null);

  const drop = async (column: BoardColumn) => {
    const todo = state.todos.find((t) => t.id === dragging);
    setDragging(null);
    setOver(null);
    if (!todo) return;
    const result = dropPatch(todo, column, now);
    if (!result) return;
    if ("reason" in result) {
      toast({ message: result.reason, durationMs: 5000 });
      return;
    }
    const reply = await patchTodo(todo.id, result.patch);
    if (!reply.ok) toast({ tone: "danger", message: reply.reason });
    onSettled();
  };

  if (state.todos.length === 0) {
    return <PanelMessage>No to-dos yet. Add one from the To-Do tab.</PanelMessage>;
  }

  return (
    <ScrollBody memoryKey="pmo-board" className={cn(GUTTER_X, "py-3")}>
      <div className="grid min-w-[44rem] grid-cols-4 gap-3" data-testid="board">
        {BOARD_COLUMNS.map(({ id, label }) => (
          <section
            key={id}
            aria-label={label}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(id);
            }}
            onDragLeave={() => setOver((c) => (c === id ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              void drop(id);
            }}
            className={cn(
              "bg-chip rounded-card flex min-h-60 flex-col gap-2 p-2.5",
              over === id && "ring-accent ring-2",
            )}
          >
            <h3 className="text-ink-soft flex items-center gap-2 px-1 text-[12.5px] font-bold">
              {label}
              <Chip tone="neutral">{columns[id].length}</Chip>
            </h3>
            {columns[id].map((todo) => (
              <article
                key={todo.id}
                draggable
                onDragStart={() => setDragging(todo.id)}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
                className="bg-surface-elevated rounded-control border-line flex cursor-grab items-stretch gap-2 border p-2.5 shadow-sm active:cursor-grabbing"
              >
                <span
                  aria-hidden
                  className={cn(
                    "w-1 shrink-0 rounded-[2px]",
                    PRIORITY_BAR[todo.priority],
                  )}
                />
                <button
                  type="button"
                  onClick={() => onOpen(todo.id)}
                  className="focus-visible:ring-focus min-w-0 flex-1 text-left outline-none focus-visible:ring-2"
                >
                  <span className="text-ink block text-[13px] leading-snug font-semibold break-words">
                    {todo.title}
                  </span>
                  <span className="text-ink-muted mt-0.5 block text-[11.5px]">
                    {todo.waitingOn
                      ? `Waiting on ${todo.waitingOn}`
                      : todo.dueAt
                        ? `Due ${formatDay(todo.dueAt, state.today)}`
                        : "No due date"}
                  </span>
                </button>
              </article>
            ))}
          </section>
        ))}
      </div>
    </ScrollBody>
  );
}
