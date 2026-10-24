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
import { Button, Progress } from "@/components/ui";
import { cn } from "@/lib/cn";
import { describeInstant } from "@/lib/pmo/due";
import type { PmoState, ReminderPrefs, Todo } from "@/lib/pmo/types";
import { patchTodo } from "./api";
import {
  CONTENT_WIDTH,
  Chip,
  FilterPill,
  GUTTER_X,
  NativeSelect,
  PILL_STRIP,
  PanelMessage,
  ROW_CARD,
  STICKY_BAR,
  type ChipTone,
} from "./parts";
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
      <div className={STICKY_BAR}>
        <div className={cn(CONTENT_WIDTH, GUTTER_X, "flex items-center gap-2.5 py-2.5")}>
          <div
            role="group"
            aria-label="To-do filter"
            className={cn(PILL_STRIP, "min-w-0 flex-1")}
          >
            {TODO_FILTERS.map(({ id, label }) => (
              <FilterPill
                key={id}
                active={filter === id}
                count={counts[id]}
                onClick={() => onViewChange({ ...view, filter: id })}
              >
                {label}
              </FilterPill>
            ))}
          </div>
          <label className="text-ink-muted flex shrink-0 items-center gap-2 text-[12px] font-semibold">
            <span className="hidden @xl:inline">Sort</span>
            <NativeSelect
              value={sort}
              aria-label="Sort to-dos"
              onChange={(event) =>
                onViewChange({ ...view, sort: event.target.value as TodoSort })
              }
              className="max-w-36"
            >
              {TODO_SORTS.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <Button
            className="shrink-0 px-3 @xl:px-[17px]"
            aria-label="New to-do"
            onClick={onNew}
          >
            <PlusIcon size={15} weight="bold" />
            <span className="hidden @xl:inline">New to-do</span>
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <PanelMessage className="min-h-56">{EMPTY[filter]}</PanelMessage>
      ) : (
        <div className={cn(CONTENT_WIDTH, GUTTER_X, "flex flex-col gap-2.5 pt-3.5 pb-6")}>
          {visible.map((todo, index) => (
            <TodoCard
              key={todo.id}
              todo={todo}
              today={state.today}
              nowIso={nowMinute}
              prefs={state.config.reminders}
              index={index}
              onOpen={onOpen}
              onSettled={onSettled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** The priority stripe at the start of a row; the word is read out for screen
 *  readers and the high ones also say it in the row's text. */
const PRIORITY_BAR: Record<Todo["priority"], string> = {
  high: "bg-[#e0584d]",
  normal: "bg-[#d29a2c]",
  low: "bg-[#5a93e0]",
};

/** One to-do. The first line is the same height on every card (priority stripe,
 *  title, who and when, a fixed-width due chip, snooze); under a hairline come
 *  only the things this to-do actually has: waiting, sign-off, snoozed, progress
 *  and the first action items. */
const TodoCard = memo(function TodoCard({
  todo,
  today,
  nowIso,
  prefs,
  index,
  onOpen,
  onSettled,
}: {
  todo: Todo;
  today: string;
  nowIso: string;
  prefs: ReminderPrefs;
  /** Position in the list; only staggers the entrance animation. */
  index: number;
  onOpen: (todoId: string) => void;
  onSettled: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const now = new Date(nowIso);
  const row = todoRowView(todo, today, now);
  const waiting = row.open ? describeWaiting(todo, now, prefs, today) : null;
  const signoff = signoffRowView(todo, now, prefs);
  const shownItems = todo.actionItems.slice(0, 3);
  const hasMore =
    !!waiting || !!signoff || row.snoozed || row.total > 0 || shownItems.length > 0;

  // The due chip: the view-logic's headline (Overdue / Due soon / Done /
  // Cancelled) when there is one, else the day itself.
  const dueChip: { label: string; tone: ChipTone } = row.headline
    ? {
        label: row.headline.label,
        tone: !row.open
          ? todo.status === "done"
            ? "success"
            : "neutral"
          : row.overdue
            ? "danger"
            : "warning",
      }
    : { label: todo.dueAt ? formatDay(todo.dueAt, today) : "No date", tone: "neutral" };

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
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
      className={cn(ROW_CARD, "flex flex-col", !row.open && "opacity-65")}
    >
      <div className="flex min-h-16 items-center gap-3.5 py-3 pr-3 pl-4">
        <span
          aria-hidden
          className={cn("h-[26px] w-1 shrink-0 rounded-[2px]", PRIORITY_BAR[todo.priority])}
        />
        <button
          type="button"
          onClick={() => onOpen(todo.id)}
          title={todo.title}
          className="focus-visible:ring-focus rounded-control flex min-w-0 flex-1 flex-col gap-0.5 text-left outline-none focus-visible:ring-2"
        >
          <span
            className={cn(
              "block truncate text-[14.5px] font-semibold",
              row.open ? "text-ink" : "text-ink-muted line-through",
            )}
          >
            {todo.title}
          </span>
          <span className="text-ink-muted flex min-w-0 items-center gap-x-3 overflow-hidden text-[12.5px] whitespace-nowrap">
            <span className="min-w-0 truncate">
              <span className="text-ink-muted">Owner </span>
              <span className="text-ink-soft font-semibold">{ownerLabel(todo.owner)}</span>
            </span>
            <span className={cn("shrink-0", row.overdue && "text-red font-semibold")}>
              {row.dueText}
            </span>
            {todo.priority === "high" && (
              <span className="text-ink-soft inline-flex shrink-0 items-center gap-1 font-semibold">
                <FlagIcon size={12} weight="fill" />
                High priority
              </span>
            )}
            <span className="text-ink-muted hidden shrink-0 @lg:inline">
              {SOURCE_LABEL[todo.source.source]}
            </span>
          </span>
        </button>
        <Chip tone={dueChip.tone} fixedWidth={92} className="shrink-0">
          {dueChip.label}
        </Chip>
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

      {hasMore && (
        <div className="border-line flex flex-col gap-2.5 border-t py-3 pr-4 pl-[38px]">
          {waiting && (
            <div
              data-testid="waiting-chip"
              className="text-ink-muted flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]"
            >
              <HourglassMediumIcon size={14} className="shrink-0" />
              <span className="min-w-0">
                Waiting on <strong className="text-ink font-semibold">{waiting.who}</strong>
                <span className="text-ink-muted">
                  {" · "}
                  {waiting.since}
                  {waiting.age && ` (${waiting.age})`}
                </span>
              </span>
              {waiting.chaseDue && <Chip tone="accent">Time to chase</Chip>}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                disabled={busyId === "reply"}
                title={`Clear "waiting on ${waiting.who}"`}
                onClick={() => void change({ waitingOn: null }, "reply")}
              >
                <CheckIcon size={13} weight="bold" />
                Got a reply
              </Button>
            </div>
          )}
          {signoff && (
            <p
              data-testid="signoff-chip"
              className="text-ink-muted flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]"
            >
              <SealCheckIcon size={14} className="shrink-0" />
              <span className="min-w-0 break-words">{signoff.text}</span>
              <Chip tone={signoff.tone}>{signoffBadgeText(signoff)}</Chip>
            </p>
          )}
          {row.snoozed && (
            <p className="text-ink-muted flex items-center gap-2 text-[12.5px]">
              <BellSlashIcon size={14} className="shrink-0" />
              Snoozed until {describeInstant(todo.reminders.snoozedUntil!, prefs.timeZone)}
            </p>
          )}

          {row.total > 0 && (
            <div className="flex items-center gap-3">
              <Progress
                value={row.percent}
                state={row.readyToClose ? "ok" : "idle"}
                aria-label="Checkpoint progress"
                aria-valuetext={`${row.done} of ${row.total} checkpoints`}
                className="w-20 shrink-0 @md:w-36"
              />
              <span className="text-ink-muted min-w-0 flex-1 truncate text-[12.5px]">
                {row.stageText}
                <span className="text-ink-muted tabular-nums">
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
            <ul className="flex flex-col gap-1.5">
              {shownItems.map((item) => (
                <li key={item.id} className="flex min-w-0 items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={item.done}
                    disabled={busyId === item.id || !row.open}
                    onChange={(event) => void toggle(item.id, event.target.checked)}
                    aria-label={item.text}
                    className="accent-accent focus-visible:ring-focus h-4 w-4 shrink-0 focus-visible:ring-2"
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[13px]",
                      item.done ? "text-ink-muted line-through" : "text-ink-soft",
                    )}
                  >
                    {item.text}
                  </span>
                  {(item.owner || item.dueAt) && (
                    <span className="text-ink-muted hidden shrink-0 text-[12px] @md:inline">
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
                    className="text-ink-muted hover:text-ink focus-visible:ring-focus rounded text-[12px] font-semibold outline-none focus-visible:ring-2"
                  >
                    +{todo.actionItems.length - shownItems.length} more
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </article>
  );
});
