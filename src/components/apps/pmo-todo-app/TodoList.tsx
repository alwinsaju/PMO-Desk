"use client";

import { useState } from "react";
import { BellSlashIcon, CheckIcon, HourglassMediumIcon, PlusIcon } from "@phosphor-icons/react";
import { Badge, Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { describeInstant, isDueSoon, isSnoozed } from "@/lib/pmo/due";
import {
  allCheckpointsComplete,
  checkpointProgress,
  deriveStage,
} from "@/lib/pmo/todoLogic";
import type { PmoState, Todo } from "@/lib/pmo/types";
import { patchTodo } from "./api";
import { SnoozeMenu } from "./SnoozeMenu";
import { SourceBadge } from "./parts";
import {
  TODO_FILTERS,
  TODO_SORTS,
  countByFilter,
  filterTodos,
  describeWaiting,
  formatDay,
  ownerLabel,
  sortTodosBy,
  type TodoFilter,
  type TodoSort,
} from "./queueView";

interface TodoListProps {
  state: PmoState;
  onOpen: (todoId: string) => void;
  onNew: () => void;
  onSettled: () => void;
}

const EMPTY: Record<TodoFilter, string> = {
  open: "No open to-dos. Approve something from the Review Queue, or create one yourself.",
  overdue: "Nothing is overdue.",
  "due-soon": "Nothing is due today or tomorrow.",
  waiting: "You are not waiting on anyone.",
  snoozed: "No to-do is snoozed.",
  done: "Nothing closed yet.",
};

export function TodoList({ state, onOpen, onNew, onSettled }: TodoListProps) {
  const [filter, setFilter] = useState<TodoFilter>("open");
  const [sort, setSort] = useState<TodoSort>("due");
  const now = new Date(state.serverTime);
  const counts = countByFilter(state.todos, state.today, now);
  const visible = sortTodosBy(
    filterTodos(state.todos, filter, state.today, now),
    sort,
    state.today,
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="To-do filter">
          {TODO_FILTERS.map(({ id, label }) => (
            <FilterPill key={id} active={filter === id} onClick={() => setFilter(id)}>
              {label} ({counts[id]})
            </FilterPill>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-ink-muted flex items-center gap-1.5 text-[12px]">
            Sort
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as TodoSort)}
              className="rounded-control border-border bg-surface-elevated text-ink focus-visible:ring-accent h-8 border px-2 text-[12px] outline-none focus-visible:ring-2"
            >
              {TODO_SORTS.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Button variant="secondary" size="sm" onClick={onNew}>
            <PlusIcon size={13} weight="bold" />
            New to-do
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="text-ink-faint py-10 text-center text-sm">{EMPTY[filter]}</p>
      ) : (
        visible.map((todo) => (
          <TodoCard
            key={todo.id}
            todo={todo}
            state={state}
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
  state,
  onOpen,
  onSettled,
}: {
  todo: Todo;
  state: PmoState;
  onOpen: () => void;
  onSettled: () => void;
}) {
  const { today } = state;
  const [busyId, setBusyId] = useState<string | null>(null);
  const open = todo.status === "open";
  const overdue = open && todo.dueAt !== null && todo.dueAt < today;
  const dueSoon = isDueSoon(todo, today);
  const snoozed = open && isSnoozed(todo, new Date(state.serverTime));
  const stage = deriveStage(todo);
  const progress = checkpointProgress(todo);
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const waiting = open
    ? describeWaiting(todo, new Date(state.serverTime), state.config.reminders, today)
    : null;
  const shownItems = todo.actionItems.slice(0, 3);
  const finished = allCheckpointsComplete(todo);

  async function change(patch: Parameters<typeof patchTodo>[1], id: string) {
    setBusyId(id);
    try {
      await patchTodo(todo.id, patch);
      onSettled();
    } finally {
      setBusyId(null);
    }
  }
  const toggle = (id: string, done: boolean) =>
    change({ actionItems: [{ id, done }] }, id);

  return (
    <div
      className={cn(
        "border-border/60 bg-surface-elevated flex flex-col gap-2.5 rounded-2xl border p-4",
        !open && "opacity-70",
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
          {!overdue && dueSoon && <Badge variant="accent">Due soon</Badge>}
          {!open && <Badge variant="outline">{todo.status}</Badge>}
          {waiting && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2.5 text-[12px]"
              disabled={busyId === "reply"}
              title={`Clear "waiting on ${waiting.who}"`}
              onClick={() => void change({ waitingOn: null }, "reply")}
            >
              <CheckIcon size={12} weight="bold" />
              Got a reply
            </Button>
          )}
          {open && (
            <SnoozeMenu
              todo={todo}
              prefs={state.config.reminders}
              nowIso={state.serverTime}
              variant="icon"
              disabled={busyId === "snooze"}
              onSnooze={(until) => void change({ snoozedUntil: until }, "snooze")}
            />
          )}
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
        {waiting && (
          <span
            data-testid="waiting-chip"
            className="inline-flex flex-wrap items-center gap-1.5"
          >
            <HourglassMediumIcon size={12} />
            Waiting on <strong className="text-ink font-medium">{waiting.who}</strong>
            <span className="text-ink-faint">
              {waiting.since}
              {waiting.age && ` (${waiting.age})`}
            </span>
            {waiting.chaseDue && <Badge variant="accent">Time to chase</Badge>}
          </span>
        )}
        {snoozed && (
          <span className="inline-flex items-center gap-1">
            <BellSlashIcon size={12} />
            Snoozed until{" "}
            {describeInstant(
              todo.reminders.snoozedUntil!,
              state.config.reminders.timeZone,
            )}
          </span>
        )}
      </div>

      {todo.checkpoints.length > 0 && (
        <div className="flex items-center gap-3">
          <div
            className="bg-neutral-150 h-2 flex-1 overflow-hidden rounded-full"
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
            {finished && open ? "All steps done" : (stage ?? "Complete")}
            <span className="text-ink-faint">
              {" · "}
              {progress.done}/{progress.total}
            </span>
          </span>
          {finished && open && (
            <Button
              variant="outline"
              size="sm"
              disabled={busyId === "done"}
              onClick={() => void change({ status: "done" }, "done")}
            >
              Mark done
            </Button>
          )}
        </div>
      )}

      {shownItems.length > 0 && (
        <ul className="flex flex-col gap-1">
          {shownItems.map((item) => (
            <li key={item.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={item.done}
                disabled={busyId === item.id || !open}
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
              {(item.owner || item.dueAt) && (
                <span className="text-ink-faint shrink-0 text-[11px]">
                  {[item.owner, item.dueAt ? formatDay(item.dueAt, today) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
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
