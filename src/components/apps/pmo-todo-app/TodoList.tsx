"use client";

import { useState } from "react";
import { PlusIcon } from "@phosphor-icons/react";
import { Badge, Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  allCheckpointsComplete,
  checkpointProgress,
  deriveStage,
} from "@/lib/pmo/todoLogic";
import type { PmoState, Todo } from "@/lib/pmo/types";
import { patchTodo } from "./api";
import { SourceBadge } from "./parts";
import { formatDay, ownerLabel, sortTodos } from "./queueView";

interface TodoListProps {
  state: PmoState;
  onOpen: (todoId: string) => void;
  onNew: () => void;
  onSettled: () => void;
}

export function TodoList({ state, onOpen, onNew, onSettled }: TodoListProps) {
  const [showClosed, setShowClosed] = useState(false);
  const sorted = sortTodos(state.todos, state.today);
  const open = sorted.filter((t) => t.status === "open");
  const closed = sorted.filter((t) => t.status !== "open");
  const visible = showClosed ? closed : open;

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1.5" role="tablist" aria-label="To-do filter">
          <FilterPill active={!showClosed} onClick={() => setShowClosed(false)}>
            Open ({open.length})
          </FilterPill>
          <FilterPill active={showClosed} onClick={() => setShowClosed(true)}>
            Done / cancelled ({closed.length})
          </FilterPill>
        </div>
        <Button variant="secondary" size="sm" onClick={onNew}>
          <PlusIcon size={13} weight="bold" />
          New to-do
        </Button>
      </div>

      {visible.length === 0 ? (
        <p className="text-ink-faint py-10 text-center text-sm">
          {showClosed
            ? "Nothing closed yet."
            : "No open to-dos. Approve something from the Review Queue, or create one yourself."}
        </p>
      ) : (
        visible.map((todo) => (
          <TodoCard
            key={todo.id}
            todo={todo}
            today={state.today}
            onOpen={() => onOpen(todo.id)}
            onSettled={onSettled}
          />
        ))
      )}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "rounded-pill ease-standard px-3 py-1 text-[12px] font-medium transition-colors duration-150",
        "focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none",
        active ? "bg-neutral-150 text-ink" : "text-ink-muted hover:bg-neutral-100",
      )}
    >
      {children}
    </button>
  );
}

function TodoCard({
  todo,
  today,
  onOpen,
  onSettled,
}: {
  todo: Todo;
  today: string;
  onOpen: () => void;
  onSettled: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const overdue = todo.status === "open" && todo.dueAt !== null && todo.dueAt < today;
  const stage = deriveStage(todo);
  const progress = checkpointProgress(todo);
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const shownItems = todo.actionItems.slice(0, 3);
  const finished = allCheckpointsComplete(todo);

  async function toggle(id: string, done: boolean) {
    setBusyId(id);
    try {
      await patchTodo(todo.id, { actionItems: [{ id, done }] });
      onSettled();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      className={cn(
        "border-border/60 bg-surface-elevated flex flex-col gap-2.5 rounded-2xl border p-4",
        todo.status !== "open" && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={onOpen}
          className="focus-visible:ring-accent min-w-0 flex-1 rounded-lg text-left outline-none focus-visible:ring-2"
        >
          <span className="text-ink line-clamp-2 text-[14px] font-semibold">
            {todo.title}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          {todo.priority === "high" && <Badge variant="outline">High</Badge>}
          {overdue && <Badge className="bg-ink text-ink-inverse">Overdue</Badge>}
          {todo.status !== "open" && <Badge variant="outline">{todo.status}</Badge>}
        </div>
      </div>

      <div className="text-ink-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
        <SourceBadge source={todo.source.source} />
        <span>
          Owner <strong className="text-ink font-medium">{ownerLabel(todo.owner)}</strong>
        </span>
        <span className={cn(overdue && "text-ink font-semibold")}>
          {todo.dueAt ? `Due ${formatDay(todo.dueAt, today)}` : "No due date"}
        </span>
        {todo.waitingOn && <span>Waiting on {todo.waitingOn}</span>}
      </div>

      {todo.checkpoints.length > 0 && (
        <div className="flex items-center gap-3">
          <div
            className="bg-neutral-150 h-1.5 flex-1 overflow-hidden rounded-full"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
            aria-label="Checkpoint progress"
          >
            <div
              className="bg-ink ease-standard h-full rounded-full transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="text-ink-muted shrink-0 text-[12px]">
            {finished && todo.status === "open"
              ? "All steps done"
              : (stage ?? "Complete")}
            <span className="text-ink-faint">
              {" · "}
              {progress.done}/{progress.total}
            </span>
          </span>
        </div>
      )}

      {shownItems.length > 0 && (
        <ul className="flex flex-col gap-1">
          {shownItems.map((item) => (
            <li key={item.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={item.done}
                disabled={busyId === item.id || todo.status !== "open"}
                onChange={(event) => void toggle(item.id, event.target.checked)}
                aria-label={item.text}
                className="accent-accent h-3.5 w-3.5 shrink-0"
              />
              <span
                className={cn(
                  "min-w-0 truncate text-[12px]",
                  item.done ? "text-ink-faint line-through" : "text-ink",
                )}
              >
                {item.text}
              </span>
            </li>
          ))}
          {todo.actionItems.length > shownItems.length && (
            <li>
              <button
                type="button"
                onClick={onOpen}
                className="text-ink-faint hover:text-ink text-[11px]"
              >
                +{todo.actionItems.length - shownItems.length} more
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
