"use client";

import { memo, useState } from "react";
import {
  BellSlashIcon,
  CheckIcon,
  FlagIcon,
  HourglassMediumIcon,
  PlusIcon,
  SealCheckIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { describeInstant } from "@/lib/pmo/due";
import type { PmoState, ReminderPrefs, Todo } from "@/lib/pmo/types";
import { patchTodo } from "./api";
import { CONTENT_WIDTH, Chip, PILL_STRIP, PanelMessage } from "./parts";
import { SnoozeMenu } from "./SnoozeMenu";
import { signoffBadgeText, signoffRowView } from "./signoffUi";
import {
  SOURCE_LABEL,
  TODO_FILTERS,
  TODO_SORTS,
  countByFilter,
  describeWaiting,
  filterTodos,
  formatDay,
  ownerLabel,
  sortTodosBy,
  todoRowView,
  type TodoFilter,
  type TodoSort,
} from "./queueView";

export interface TodoViewChoice {
  filter: TodoFilter;
  sort: TodoSort;
}

interface TodoListProps {
  state: PmoState;
  /** The chosen filter and sort. Kept by the window so they survive a tab switch. */
  view: TodoViewChoice;
  onViewChange: (view: TodoViewChoice) => void;
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

export function TodoList({
  state,
  view,
  onViewChange,
  onOpen,
  onNew,
  onSettled,
}: TodoListProps) {
  const { filter, sort } = view;
  const now = new Date(state.serverTime);
  const counts = countByFilter(state.todos, state.today, now);
  const visible = sortTodosBy(
    filterTodos(state.todos, filter, state.today, now),
    sort,
    state.today,
  );
  // Whole minutes, so a card only redraws when something it shows can differ
  // (the server clock moves on every 3 s poll).
  const nowMinute = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();

  return (
    <div className="flex flex-col">
      {/* Stays at the top while the list scrolls under it. */}
      <div className="bg-surface-elevated border-border sticky top-0 z-10 border-b">
        <div className={cn(CONTENT_WIDTH, "flex items-center gap-2 px-3 py-2 @md:px-4")}>
          <div
            role="group"
            aria-label="To-do filter"
            className={cn(PILL_STRIP, "min-w-0 flex-1")}
          >
            {TODO_FILTERS.map(({ id, label }) => (
              <FilterPill
                key={id}
                active={filter === id}
                onClick={() => onViewChange({ ...view, filter: id })}
              >
                {label}
                <span className="text-ink-faint ml-1 tabular-nums">{counts[id]}</span>
              </FilterPill>
            ))}
          </div>
          <label className="text-ink-muted flex shrink-0 items-center gap-1.5 text-[12px]">
            <span className="hidden @xl:inline">Sort</span>
            <select
              value={sort}
              aria-label="Sort to-dos"
              onChange={(event) =>
                onViewChange({ ...view, sort: event.target.value as TodoSort })
              }
              className="rounded-control border-border bg-surface-elevated text-ink focus-visible:ring-accent h-8 max-w-32 border px-2 text-[12px] outline-none focus-visible:ring-2"
            >
              {TODO_SORTS.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0 px-2 @xl:px-3"
            aria-label="New to-do"
            onClick={onNew}
          >
            <PlusIcon size={14} weight="bold" />
            <span className="hidden @xl:inline">New to-do</span>
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <PanelMessage className="min-h-56">{EMPTY[filter]}</PanelMessage>
      ) : (
        <div className={cn(CONTENT_WIDTH, "flex flex-col gap-2.5 p-3 @md:p-4")}>
          {visible.map((todo) => (
            <TodoCard
              key={todo.id}
              todo={todo}
              today={state.today}
              nowIso={nowMinute}
              prefs={state.config.reminders}
              onOpen={onOpen}
              onSettled={onSettled}
            />
          ))}
        </div>
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
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-pill ease-standard shrink-0 px-2.5 py-1 text-[12px] font-medium whitespace-nowrap transition-colors duration-150",
        "focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none",
        active ? "bg-neutral-150 text-ink" : "text-ink-muted hover:bg-neutral-100",
      )}
    >
      {children}
    </button>
  );
}

/** One to-do. Reading order is the hierarchy: the title, then who and when,
 *  then where it stands (waiting / snoozed / progress), then the next steps. At
 *  most one chip (the urgent one) sits beside the title. */
const TodoCard = memo(function TodoCard({
  todo,
  today,
  nowIso,
  prefs,
  onOpen,
  onSettled,
}: {
  todo: Todo;
  today: string;
  nowIso: string;
  prefs: ReminderPrefs;
  onOpen: (todoId: string) => void;
  onSettled: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const now = new Date(nowIso);
  const row = todoRowView(todo, today, now);
  const waiting = row.open ? describeWaiting(todo, now, prefs, today) : null;
  const signoff = signoffRowView(todo, now, prefs);
  const shownItems = todo.actionItems.slice(0, 3);

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
    <article
      className={cn(
        "border-border bg-surface-elevated flex min-w-0 flex-col gap-2 rounded-2xl border px-3.5 py-3",
        !row.open && "opacity-70",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => onOpen(todo.id)}
          className="focus-visible:ring-accent min-w-0 flex-1 rounded-lg text-left outline-none focus-visible:ring-2"
        >
          <span className="text-ink line-clamp-2 text-[14px] leading-snug font-semibold break-words">
            {todo.title}
          </span>
        </button>
        {row.headline && (
          <Chip tone={row.headline.tone} className="shrink-0">
            {row.headline.label}
          </Chip>
        )}
        {row.open && (
          <SnoozeMenu
            todo={todo}
            prefs={prefs}
            nowIso={nowIso}
            variant="icon"
            disabled={busyId === "snooze"}
            onSnooze={(until) => void change({ snoozedUntil: until }, "snooze")}
          />
        )}
      </div>

      <p className="text-ink-muted flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px]">
        <span>
          <span className="text-ink-faint">Owner </span>
          <span className="text-ink font-medium">{ownerLabel(todo.owner)}</span>
        </span>
        <span className={cn(row.overdue && "text-ink font-semibold")}>{row.dueText}</span>
        {todo.priority === "high" && (
          <span className="text-ink inline-flex items-center gap-1 font-medium">
            <FlagIcon size={12} weight="fill" />
            High priority
          </span>
        )}
        <span className="text-ink-faint">{SOURCE_LABEL[todo.source.source]}</span>
      </p>

      {waiting && (
        <div
          data-testid="waiting-chip"
          className="text-ink-muted flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]"
        >
          <HourglassMediumIcon size={13} className="shrink-0" />
          <span className="min-w-0">
            Waiting on <strong className="text-ink font-medium">{waiting.who}</strong>
            <span className="text-ink-faint">
              {" · "}
              {waiting.since}
              {waiting.age && ` (${waiting.age})`}
            </span>
          </span>
          {waiting.chaseDue && <Chip tone="accent">Time to chase</Chip>}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2.5 text-[12px]"
            disabled={busyId === "reply"}
            title={`Clear "waiting on ${waiting.who}"`}
            onClick={() => void change({ waitingOn: null }, "reply")}
          >
            <CheckIcon size={12} weight="bold" />
            Got a reply
          </Button>
        </div>
      )}
      {signoff && (
        <p
          data-testid="signoff-chip"
          className="text-ink-muted flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]"
        >
          <SealCheckIcon size={13} className="shrink-0" />
          <span className="min-w-0 break-words">{signoff.text}</span>
          <Chip tone={signoff.tone}>{signoffBadgeText(signoff)}</Chip>
        </p>
      )}
      {row.snoozed && (
        <p className="text-ink-muted flex items-center gap-1.5 text-[12px]">
          <BellSlashIcon size={13} className="shrink-0" />
          Snoozed until {describeInstant(todo.reminders.snoozedUntil!, prefs.timeZone)}
        </p>
      )}

      {row.total > 0 && (
        <div className="flex items-center gap-2.5">
          <div
            className="bg-neutral-150 h-1.5 w-20 shrink-0 overflow-hidden rounded-full @md:w-32"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={row.total}
            aria-valuenow={row.done}
            aria-label="Checkpoint progress"
          >
            <div
              className="ease-standard h-full rounded-full bg-neutral-600 transition-[width] duration-300"
              style={{ width: `${row.percent}%` }}
            />
          </div>
          <span className="text-ink-muted min-w-0 flex-1 truncate text-[12px]">
            {row.stageText}
            <span className="text-ink-faint tabular-nums">
              {" · "}
              {row.done}/{row.total}
            </span>
          </span>
          {row.readyToClose && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
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
            <li key={item.id} className="flex min-w-0 items-center gap-2">
              <input
                type="checkbox"
                checked={item.done}
                disabled={busyId === item.id || !row.open}
                onChange={(event) => void toggle(item.id, event.target.checked)}
                aria-label={item.text}
                className="accent-accent focus-visible:ring-accent h-3.5 w-3.5 shrink-0 focus-visible:ring-2"
              />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[12px]",
                  item.done ? "text-ink-faint line-through" : "text-ink",
                )}
              >
                {item.text}
              </span>
              {(item.owner || item.dueAt) && (
                <span className="text-ink-faint hidden shrink-0 text-[11px] @md:inline">
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
                onClick={() => onOpen(todo.id)}
                className="text-ink-faint hover:text-ink focus-visible:ring-accent rounded text-[11px] outline-none focus-visible:ring-2"
              >
                +{todo.actionItems.length - shownItems.length} more
              </button>
            </li>
          )}
        </ul>
      )}
    </article>
  );
});
