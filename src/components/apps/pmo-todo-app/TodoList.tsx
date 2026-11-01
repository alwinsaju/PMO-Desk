"use client";

import { memo, useRef, useState, type KeyboardEvent } from "react";
import {
  BellSlashIcon,
  CalendarCheckIcon,
  CheckIcon,
  FlagIcon,
  HourglassMediumIcon,
  NotePencilIcon,
  PencilSimpleIcon,
  PlusIcon,
  RepeatIcon,
  SealCheckIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { Button, DueChip, IconButton, Input, PriorityStripe, Progress } from "@/components/ui";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/notifications/toastStore";
import { describeInstant } from "@/lib/pmo/due";
import { parseDate } from "@/lib/ui/dates";
import { MAX_QUICK_ADD_LENGTH, parseQuickAdd } from "@/lib/pmo/quickAdd";
import { emptyDraft } from "@/lib/pmo/todoLogic";
import type { PmoState, ReminderPrefs, Todo } from "@/lib/pmo/types";
import { clearCancelled, createTodo, patchTodo, type NextOffer } from "./api";
import {
  CONTENT_WIDTH,
  Chip,
  FilterPill,
  GUTTER_X,
  NativeSelect,
  PanelMessage,
  ROW_CARD,
  STICKY_BAR,
  type ChipTone,
} from "./parts";
import { SnoozeMenu } from "./SnoozeMenu";
import { isTypingTarget, listKeyAction } from "./listKeys";
import { continueRecurrence } from "./recurHelper";
import { BulkBar, ListTools } from "./ListTools";
import { MeetingNotesDialog, PlanWeekDialog } from "./PlanDialogs";
import { applyExtras, flagReason, similarTodos } from "@/lib/pmo/pmoViews";
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
  repeatsText,
  sortTodosBy,
  todoRowView,
  type TodoFilter,
  type TodoSort,
} from "./queueView";

export interface TodoViewChoice {
  filter: TodoFilter;
  sort: TodoSort;
  /** Only to-dos with this tag. */
  tag: string | null;
  /** Only to-dos whose text has all these words. */
  text: string;
}

interface TodoListProps {
  state: PmoState;
  /** The chosen filter and sort. Kept by the window so they survive a tab switch. */
  view: TodoViewChoice;
  onViewChange: (view: TodoViewChoice) => void;
  onOpen: (todoId: string) => void;
  onNew: () => void;
  /** A repeating to-do was just closed from the list: hold the offer for the next one. */
  onNextOffer: (offer: NextOffer) => void;
  onSettled: () => void;
}

const EMPTY: Record<TodoFilter, string> = {
  open: "No open to-dos. Approve something from the Review Queue, or create one yourself.",
  today: "Nothing is due today or earlier. Enjoy the quiet.",
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
  onNextOffer,
  onSettled,
}: TodoListProps) {
  const { filter, sort } = view;
  const now = new Date(state.serverTime);
  const counts = countByFilter(state.todos, state.today, now);
  const visible = applyExtras(
    sortTodosBy(filterTodos(state.todos, filter, state.today, now), sort, state.today),
    { tag: view.tag, text: view.text },
  );
  // Why each to-do needs a look, worked out once here so the cards stay plain.
  const flags = new Map(
    visible.map((t) => [
      t.id,
      flagReason(t, state.todos, state.today, now, state.config.reminders),
    ]),
  );
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [planOpen, setPlanOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const selectedTodos = state.todos.filter((t) => selectedIds.has(t.id));
  const toggleSelected = (id: string) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const cancelledCount = state.todos.filter((todo) => todo.status === "cancelled").length;
  // Whole minutes, so a card only redraws when something it shows can differ
  // (the server clock moves on every 3 s poll).
  const nowMinute = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();

  const listRef = useRef<HTMLDivElement>(null);

  /** "D": close the to-do, with an Undo (a repeating one opens its next-occurrence offer instead). */
  async function markDone(todo: Todo) {
    if (todo.status !== "open") return;
    try {
      const reply = await patchTodo(todo.id, { status: "done" });
      if (!reply.ok) {
        toast({ tone: "danger", message: reply.reason });
        return;
      }
      if (reply.nextOccurrence) {
        const next = reply.nextOccurrence;
        await continueRecurrence(reply.todo, next, state.today, () => {
          onNextOffer({ todo: reply.todo, dueAt: next.dueAt });
          onOpen(todo.id);
        });
      } else {
        toast({
          key: `done-${todo.id}`,
          message: `Marked "${todo.title}" done.`,
          action: {
            label: "Undo",
            run: () => void patchTodo(todo.id, { status: "open" }).then(onSettled),
          },
        });
      }
    } catch {
      toast({ tone: "danger", message: "Could not reach the app server." });
    }
    onSettled();
  }

  function handleListKey(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (isTypingTarget(target)) return;
    const cards = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-todo-card]") ?? [],
    );
    const current = cards.findIndex((card) => card.contains(target));
    const action = listKeyAction(event, current, cards.length);
    if (!action) return;
    // Enter on a button inside a card is that button's own click.
    if (event.key === "Enter" && !target.hasAttribute("data-todo-card")) return;
    event.preventDefault();
    if (action.type === "move") {
      cards[action.index]?.focus();
      cards[action.index]?.scrollIntoView({ block: "nearest" });
      return;
    }
    const card = cards[current];
    const todo = visible.find((t) => t.id === card?.dataset.todoId);
    if (!card || !todo) return;
    if (action.type === "open") onOpen(todo.id);
    else if (action.type === "done") void markDone(todo);
    else {
      card
        .querySelector<HTMLElement>(
          '[aria-label="Snooze reminders"], [aria-label="Change snooze"]',
        )
        ?.click();
    }
  }

  return (
    <div className="flex flex-col">
      {/* Stays at the top while the list scrolls under it. */}
      <div className={STICKY_BAR}>
        <div
          className={cn(
            CONTENT_WIDTH,
            GUTTER_X,
            "flex flex-wrap items-center gap-x-2.5 gap-y-2 py-2",
          )}
        >
          {/* Wraps onto a second line rather than hiding the last chips. */}
          <div
            role="group"
            aria-label="To-do filter"
            className="flex min-w-0 flex-1 flex-wrap gap-1.5"
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
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <label className="text-ink-muted flex items-center gap-2 text-[12px] font-semibold">
              <span className="hidden @2xl:inline">Sort</span>
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
            <IconButton
              variant="ghost"
              aria-label="Plan my week"
              tooltip="Plan my week"
              onClick={() => setPlanOpen(true)}
            >
              <CalendarCheckIcon size={16} />
            </IconButton>
            <IconButton
              variant="ghost"
              aria-label="From meeting notes"
              tooltip="Add to-dos from meeting notes"
              onClick={() => setNotesOpen(true)}
            >
              <NotePencilIcon size={16} />
            </IconButton>
            <Button
              className="px-3 @xl:px-[17px]"
              aria-label="New to-do"
              onClick={onNew}
            >
              <PlusIcon size={15} weight="bold" />
              <span className="hidden @xl:inline">New to-do</span>
            </Button>
          </div>
        </div>
      </div>

      {filter === "done" && cancelledCount > 0 && (
        <ClearCancelledBar count={cancelledCount} onSettled={onSettled} />
      )}

      <ListTools
        state={state}
        view={view}
        onViewChange={onViewChange}
        quickAdd={
          <QuickAddBar today={state.today} todos={state.todos} onSettled={onSettled} />
        }
      />
      {selectedTodos.length > 0 && (
        <BulkBar
          selected={selectedTodos}
          state={state}
          onClear={() => setSelectedIds(new Set())}
          onSettled={onSettled}
        />
      )}

      {visible.length === 0 ? (
        <PanelMessage className="min-h-56">{EMPTY[filter]}</PanelMessage>
      ) : (
        <div
          ref={listRef}
          tabIndex={0}
          aria-label="To-do list. J and K move, E opens, D marks done, S snoozes."
          onKeyDown={handleListKey}
          className={cn(
            CONTENT_WIDTH,
            GUTTER_X,
            "focus-visible:ring-focus rounded-control flex flex-col gap-2.5 pt-2.5 pb-6 outline-none focus-visible:ring-2",
          )}
        >
          {visible.map((todo, index) => (
            <TodoCard
              key={todo.id}
              todo={todo}
              today={state.today}
              nowIso={nowMinute}
              prefs={state.config.reminders}
              index={index}
              flag={flags.get(todo.id) ?? null}
              selected={selectedIds.has(todo.id)}
              onToggleSelected={toggleSelected}
              onOpen={onOpen}
              onNextOffer={onNextOffer}
              onSettled={onSettled}
            />
          ))}
          <p className="text-ink-faint pt-1 text-center text-[11.5px]">
            Keyboard: J / K move · E open · D done · S snooze
          </p>
        </div>
      )}
      <PlanWeekDialog
        state={state}
        open={planOpen}
        onOpenChange={setPlanOpen}
        onOpenTodo={onOpen}
      />
      <MeetingNotesDialog
        state={state}
        open={notesOpen}
        onOpenChange={setNotesOpen}
        onSettled={onSettled}
      />
    </div>
  );
}

/** Type a to-do and press Enter: "Send deck to Priya Fri" is created for you, due that Friday.
 *  The day shown under the box is what will be saved, so there are no surprises. */
function QuickAddBar({
  today,
  todos,
  onSettled,
}: {
  today: string;
  todos: readonly Todo[];
  onSettled: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseQuickAdd(text, today);
  const lookAlike = parsed ? similarTodos(parsed.title, todos, 1)[0] : undefined;

  const add = async () => {
    if (!parsed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const reply = await createTodo({
        ...emptyDraft(parsed.title),
        owner: { name: null, email: null, isMe: true },
        dueAt: parsed.dueAt,
      });
      if (!reply.ok) {
        setError(reply.reason);
        return;
      }
      setText("");
      onSettled();
      toast({
        key: "quick-add",
        tone: "success",
        message: parsed.dueAt
          ? `Added "${parsed.title}", due ${formatDay(parsed.dueAt, today)}.`
          : `Added "${parsed.title}".`,
      });
    } catch {
      setError("Could not reach the app server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-w-56 flex-[2]">
      <Input
        value={text}
        disabled={busy}
        maxLength={MAX_QUICK_ADD_LENGTH}
        aria-label="Quick add a to-do"
        placeholder="Add a to-do, e.g. Send deck to Priya Fri"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void add();
          }
        }}
      />
      {error ? (
        <p role="alert" className="text-red mt-1.5 text-[12px] font-semibold">
          {error}
        </p>
      ) : (
        parsed && (
          <p className="text-ink-muted mt-1.5 text-[12px]" aria-live="polite">
            {parsed.dueAt ? `Due ${formatDay(parsed.dueAt, today)}` : "No due date"}
            {lookAlike && (
              <span className="text-amber ml-2 font-semibold">
                Looks like an existing to-do: “{lookAlike.title}”
              </span>
            )}
          </p>
        )
      )}
    </div>
  );
}

/** "Clear cancelled": removes every cancelled to-do for good, after one confirm click.
 *  Done to-dos stay (they feed the weekly report); cancelled ones are only noise. */
function ClearCancelledBar({
  count,
  onSettled,
}: {
  count: number;
  onSettled: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clear = async () => {
    setBusy(true);
    setError(null);
    try {
      const reply = await clearCancelled();
      if (!reply.ok) setError(reply.reason);
      else {
        setConfirming(false);
        onSettled();
      }
    } catch {
      setError("Could not reach the app server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(CONTENT_WIDTH, GUTTER_X, "flex flex-wrap items-center gap-2.5 pt-3")}
    >
      <span className="text-ink-muted text-[12.5px]">
        {error ??
          (confirming
            ? `Delete ${count} cancelled ${count === 1 ? "to-do" : "to-dos"} for good?`
            : `${count} cancelled ${count === 1 ? "to-do" : "to-dos"} in this list.`)}
      </span>
      <span className="ml-auto flex items-center gap-2">
        {confirming ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Keep
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void clear()}>
              <TrashIcon size={14} weight="bold" />
              Delete
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
            <TrashIcon size={14} weight="bold" />
            Clear cancelled
          </Button>
        )}
      </span>
    </div>
  );
}

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
  flag,
  selected,
  onToggleSelected,
  onOpen,
  onNextOffer,
  onSettled,
}: {
  todo: Todo;
  today: string;
  nowIso: string;
  prefs: ReminderPrefs;
  /** Position in the list; only staggers the entrance animation. */
  index: number;
  /** One line on why it needs a look ("Overdue by 3 days"), worked out by the list. */
  flag: string | null;
  selected: boolean;
  onToggleSelected: (todoId: string) => void;
  onOpen: (todoId: string) => void;
  onNextOffer: (offer: NextOffer) => void;
  onSettled: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const now = new Date(nowIso);
  const row = todoRowView(todo, today, now);
  const waiting = row.open ? describeWaiting(todo, now, prefs, today) : null;
  const signoff = signoffRowView(todo, now, prefs);
  const shownItems = todo.actionItems.slice(0, 3);
  const repeats = repeatsText(todo.recurrence);
  const hasMore =
    !!waiting ||
    !!signoff ||
    !!repeats ||
    row.snoozed ||
    row.total > 0 ||
    shownItems.length > 0;

  // The due chip: the view-logic's headline (Overdue / Due soon / Done /
  // Cancelled) when there is one, else the shared due chip for the day itself.
  const headlineTone: ChipTone = !row.open
    ? todo.status === "done"
      ? "success"
      : "neutral"
    : row.overdue
      ? "danger"
      : "warning";

  async function change(patch: Parameters<typeof patchTodo>[1], id: string) {
    setBusyId(id);
    try {
      const reply = await patchTodo(todo.id, patch);
      // A repeating to-do closed from the list: open it, where the offer to
      // create the next one is shown.
      if (reply.ok && reply.nextOccurrence) {
        const next = reply.nextOccurrence;
        await continueRecurrence(reply.todo, next, today, () => {
          onNextOffer({ todo: reply.todo, dueAt: next.dueAt });
          onOpen(todo.id);
        });
      }
      onSettled();
    } finally {
      setBusyId(null);
    }
  }
  const toggle = (id: string, done: boolean) =>
    change({ actionItems: [{ id, done }] }, id);

  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(todo.title);
  const startEditing = () => {
    setDraftTitle(todo.title);
    setEditing(true);
  };
  const saveTitle = async () => {
    setEditing(false);
    const title = draftTitle.trim();
    if (title && title !== todo.title) await change({ title }, "title");
  };

  return (
    <article
      data-todo-card
      data-todo-id={todo.id}
      tabIndex={-1}
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
      className={cn(
        ROW_CARD,
        "focus-visible:ring-focus flex flex-col outline-none focus-visible:ring-2",
        !row.open && "opacity-65",
      )}
    >
      <div className="flex min-h-14 items-center gap-3.5 py-2.5 pr-3 pl-4">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelected(todo.id)}
          aria-label={`Tick ${todo.title}`}
          className="accent-accent h-4 w-4 shrink-0 cursor-pointer"
        />
        <PriorityStripe
          priority={todo.priority}
          className="h-[26px] self-center"
        />
        {editing ? (
          <Input
            autoFocus
            value={draftTitle}
            maxLength={200}
            aria-label={`Rename ${todo.title}`}
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(event) => {
              if (event.key === "Enter") void saveTitle();
              if (event.key === "Escape") setEditing(false);
            }}
            className="min-w-0 flex-1"
          />
        ) : (
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
                <span className="text-ink-soft font-semibold">
                  {ownerLabel(todo.owner)}
                </span>
              </span>
              <span className={cn("shrink-0", row.overdue && "text-red font-semibold")}>
                {row.dueText}
              </span>
              {flag && (
                <span
                  data-testid="flag-reason"
                  className="text-amber shrink-0 font-semibold"
                >
                  {flag}
                </span>
              )}
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
        )}
        {row.open && !editing && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 px-2"
            aria-label={`Rename ${todo.title}`}
            title="Rename"
            onClick={startEditing}
          >
            <PencilSimpleIcon size={14} />
          </Button>
        )}
        {row.headline ? (
          <Chip tone={headlineTone} fixedWidth={92} className="shrink-0">
            {row.headline.label}
          </Chip>
        ) : (
          <DueChip
            due={todo.dueAt}
            now={parseDate(today) ?? undefined}
            fixedWidth={92}
            className="shrink-0"
          />
        )}
        {row.open && (
          <SnoozeMenu
            todo={todo}
            prefs={prefs}
            nowIso={nowIso}
            variant="icon"
            disabled={busyId === "snooze"}
            onSnooze={(until) => {
              const before = todo.reminders.snoozedUntil ?? null;
              void change({ snoozedUntil: until }, "snooze").then(() =>
                toast({
                  key: `snooze-${todo.id}`,
                  message: until ? `Snoozed "${todo.title}".` : `Woke "${todo.title}".`,
                  action: {
                    label: "Undo",
                    run: () =>
                      void patchTodo(todo.id, { snoozedUntil: before }).then(onSettled),
                  },
                }),
              );
            }}
          />
        )}
      </div>

      {hasMore && (
        <div className="border-line flex flex-col gap-2 border-t py-2.5 pr-4 pl-[38px]">
          {waiting && (
            <div
              data-testid="waiting-chip"
              className="text-ink-muted flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]"
            >
              <HourglassMediumIcon size={14} className="shrink-0" />
              <span className="min-w-0">
                Waiting on{" "}
                <strong className="text-ink font-semibold">{waiting.who}</strong>
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
              Snoozed until{" "}
              {describeInstant(todo.reminders.snoozedUntil!, prefs.timeZone)}
            </p>
          )}

          {repeats && (
            <p
              data-testid="repeats-text"
              title="Shown for reference. The app does not repeat to-dos or send recurring reminders."
              className="text-ink-muted flex min-w-0 items-center gap-2 text-[12.5px]"
            >
              <RepeatIcon size={14} className="shrink-0" />
              <span className="min-w-0 truncate">{repeats}</span>
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
