"use client";

import { useState } from "react";
import { DotsSixVerticalIcon } from "@phosphor-icons/react";
import { DueChip, PriorityStripe } from "@/components/ui";
import { Chip, GUTTER_X, PanelMessage, PersonTag, ScrollBody } from "./parts";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/notifications/toastStore";
import {
  BOARD_COLUMNS,
  boardColumns,
  dropPatch,
  type BoardColumn,
} from "@/lib/pmo/pmoViews";
import type { PmoState, Todo } from "@/lib/pmo/types";
import { parseDate } from "@/lib/ui/dates";
import { patchTodo } from "./api";
import { ownerLabel } from "./queueView";
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
        {BOARD_COLUMNS.map(({ id, label }) => {
          const cards = columns[id];
          const dropping = dragging !== null && over === id;
          return (
            <section
              key={id}
              aria-label={label}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(id);
              }}
              onDragLeave={(e) => {
                // Moving over a card inside the column is not leaving it.
                if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                  setOver((c) => (c === id ? null : c));
              }}
              onDrop={(e) => {
                e.preventDefault();
                void drop(id);
              }}
              className={cn(
                "bg-chip rounded-card flex min-h-60 flex-col gap-2 border-2 border-transparent p-2.5 transition-colors",
                dropping && "border-accent bg-accent-soft border-dashed",
              )}
            >
              <h3 className="text-ink-soft flex items-center gap-2 px-1 text-[12.5px] font-bold">
                {label}
                <Chip tone="neutral" aria-label={`${cards.length} to-dos`}>
                  {cards.length}
                </Chip>
              </h3>
              {cards.map((todo) => (
                <BoardCard
                  key={todo.id}
                  todo={todo}
                  today={state.today}
                  dragging={dragging === todo.id}
                  onOpen={onOpen}
                  onDragStart={setDragging}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                />
              ))}
              {cards.length === 0 && (
                <p className="text-ink-muted px-1 py-4 text-center text-[12.5px]">
                  {dropping ? "Drop to move here" : "Nothing here"}
                </p>
              )}
            </section>
          );
        })}
      </div>
    </ScrollBody>
  );
}

/** One card: a grip to show it can be dragged, the priority stripe, the title and
 *  the same chips the list uses (due, owner, who it is waiting on). */
function BoardCard({
  todo,
  today,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  todo: Todo;
  today: string;
  dragging: boolean;
  onOpen: (todoId: string) => void;
  onDragStart: (todoId: string) => void;
  onDragEnd: () => void;
}) {
  const done = todo.status === "done";
  return (
    <article
      draggable
      onDragStart={() => onDragStart(todo.id)}
      onDragEnd={onDragEnd}
      className={cn(
        "bg-surface-elevated rounded-control border-line flex cursor-grab items-stretch gap-1.5 border py-2.5 pr-2.5 pl-1 shadow-sm active:cursor-grabbing",
        dragging && "opacity-50",
      )}
    >
      <DotsSixVerticalIcon
        size={16}
        weight="bold"
        aria-hidden
        className="text-ink-faint mt-0.5 shrink-0"
      />
      <PriorityStripe priority={todo.priority} />
      <button
        type="button"
        onClick={() => onOpen(todo.id)}
        className="focus-ring rounded-control flex min-w-0 flex-1 flex-col gap-1.5 text-left"
      >
        <span
          className={cn(
            "block text-[13px] leading-snug font-semibold break-words",
            done ? "text-ink-muted line-through" : "text-ink",
          )}
        >
          {todo.title}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <DueChip due={todo.dueAt} now={parseDate(today) ?? undefined} done={done} />
          <PersonTag
            name={todo.owner.name || todo.owner.email}
            label={ownerLabel(todo.owner)}
            className="text-ink-soft text-[12px] font-semibold"
          />
        </span>
        {todo.waitingOn && (
          <span className="text-ink-muted flex min-w-0 items-center gap-1.5 text-[12px]">
            Waiting on
            <PersonTag name={todo.waitingOn} className="text-ink-soft font-semibold" />
          </span>
        )}
      </button>
    </article>
  );
}
