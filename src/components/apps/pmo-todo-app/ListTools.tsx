"use client";

import { useId, useState, type ReactNode } from "react";
import {
  BookmarkSimpleIcon,
  CaretDownIcon,
  DownloadSimpleIcon,
  MagnifyingGlassIcon,
  TagIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/notifications/toastStore";
import { usePreferences } from "@/lib/preferences/preferencesStore";
import { snoozeUntil } from "@/lib/pmo/due";
import { useHolidayDates } from "@/lib/staff/holidayDatesStore";
import { noSpellcheck } from "@/lib/ui/noSpellcheck";
import { downloadFile } from "@/lib/ui/downloadFile";
import { buildXlsx, XLSX_MIME } from "@/lib/xlsx/writeXlsx";
import {
  exportScopeText,
  todoExportFilename,
  todosToCsv,
  todosToSheets,
  type ExportScope,
} from "@/lib/pmo/todoExport";
import { todayIso } from "@/lib/staff/dates";
import {
  bulkPatches,
  bulkSummary,
  bulkUndo,
  tagRollup,
  type BulkAction,
} from "@/lib/pmo/pmoViews";
import type { PmoState, Todo } from "@/lib/pmo/types";
import { patchTodo } from "./api";
import { appliedUndo } from "./bulkSelection";
import { CONTENT_WIDTH, FilterPill, GUTTER_X, NativeSelect } from "./parts";
import { TODO_FILTERS, TODO_SORTS, type TodoFilter, type TodoSort } from "./queueView";

export interface ViewState {
  filter: TodoFilter;
  sort: TodoSort;
  tag: string | null;
  text: string;
}

const isFilter = (v: string): v is TodoFilter => TODO_FILTERS.some((f) => f.id === v);
const isSort = (v: string): v is TodoSort => TODO_SORTS.some((s) => s.id === v);

/** Quick-add, search, tag filter and saved views above the list; the tag
 *  rollup is behind a toggle so the cards start higher. */
export function ListTools({
  state,
  view,
  onViewChange,
  quickAdd,
  visible,
}: {
  state: PmoState;
  view: ViewState;
  onViewChange: (view: ViewState) => void;
  /** The quick-add box, laid out as the first control of the row. */
  quickAdd?: ReactNode;
  /** The to-dos the list shows now (filter, tag and search applied): what "current list" exports. */
  visible?: readonly Todo[];
}) {
  const savedViews = usePreferences((s) => s.savedViews);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [statsOpen, setStatsOpen] = useState(false);
  const statsId = useId();
  const tags = tagRollup(state.todos, state.today);

  const exportTodos = (scope: ExportScope, format: "csv" | "xlsx") => {
    const todos = scope === "filtered" ? (visible ?? state.todos) : state.todos;
    if (todos.length === 0) {
      toast({ tone: "warning", message: "There are no to-dos to export." });
      return;
    }
    try {
      const name = todoExportFilename(scope, format, todayIso());
      if (format === "csv") {
        downloadFile(name, todosToCsv(todos), "text/csv;charset=utf-8");
      } else {
        downloadFile(name, buildXlsx(todosToSheets(todos)), XLSX_MIME);
      }
      toast({
        tone: "success",
        message: `Saved ${name} with ${todos.length} ${todos.length === 1 ? "to-do" : "to-dos"}.`,
      });
    } catch {
      toast({ tone: "danger", message: "Could not create the export file." });
    }
  };
  const currentCount = (visible ?? state.todos).length;

  const save = () => {
    const label = name.trim();
    if (!label) return;
    usePreferences.getState().saveView({
      id: `v${Date.now().toString(36)}`,
      name: label,
      filter: view.filter,
      sort: view.sort,
      tag: view.tag,
      text: view.text,
    });
    setName("");
    setNaming(false);
    toast({ message: `Saved the view “${label}”.`, durationMs: 3000 });
  };

  return (
    <div className={cn(CONTENT_WIDTH, GUTTER_X, "flex flex-col gap-2 pt-2")}>
      <div className="flex flex-wrap items-start gap-2">
        {quickAdd}
        <div className="relative min-w-40 flex-1">
          <MagnifyingGlassIcon
            size={14}
            className="text-ink-muted pointer-events-none absolute top-[18px] left-3 -translate-y-1/2"
            aria-hidden
          />
          <Input
            {...noSpellcheck}
            value={view.text}
            aria-label="Search to-dos"
            placeholder="Search to-dos"
            className="pl-8"
            onChange={(e) => onViewChange({ ...view, text: e.target.value })}
          />
        </div>
        {tags.length > 0 && (
          <NativeSelect
            value={view.tag ?? ""}
            aria-label="Filter by tag"
            className="max-w-40"
            onChange={(e) => onViewChange({ ...view, tag: e.target.value || null })}
          >
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t.tag} value={t.tag}>
                {t.tag} ({t.open})
              </option>
            ))}
          </NativeSelect>
        )}
        {naming ? (
          <span className="flex items-center gap-1.5">
            <Input
              autoFocus
              value={name}
              aria-label="Name for this view"
              placeholder="Name this view"
              className="w-40"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setNaming(false);
              }}
            />
            <Button size="sm" onClick={save} disabled={!name.trim()}>
              Save
            </Button>
          </span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => setNaming(true)}
            aria-label="Save this view"
          >
            <BookmarkSimpleIcon size={14} />
            Save view
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-9"
              aria-label="Export to-dos"
              data-testid="todo-export"
            >
              <DownloadSimpleIcon size={14} />
              Export
              <CaretDownIcon size={11} weight="bold" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-w-72">
            <DropdownMenuLabel className="text-ink-soft text-[12.5px] font-semibold tracking-normal whitespace-normal normal-case">
              Export {exportScopeText("filtered", currentCount)}
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => exportTodos("filtered", "csv")}>
              CSV, current list
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => exportTodos("filtered", "xlsx")}>
              Excel, current list
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-ink-soft text-[12.5px] font-semibold tracking-normal whitespace-normal normal-case">
              Export {exportScopeText("all", state.todos.length)}
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => exportTodos("all", "csv")}>
              CSV, all to-dos
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => exportTodos("all", "xlsx")}>
              Excel, all to-dos
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {tags.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            aria-expanded={statsOpen}
            aria-controls={statsId}
            onClick={() => setStatsOpen((open) => !open)}
          >
            <TagIcon size={14} />
            Tag stats
            <CaretDownIcon
              size={11}
              weight="bold"
              className={cn("transition-transform", statsOpen && "rotate-180")}
            />
          </Button>
        )}
      </div>

      {savedViews.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Saved views"
        >
          {savedViews.map((v) => (
            <span key={v.id} className="inline-flex items-center">
              <FilterPill
                active={false}
                onClick={() =>
                  onViewChange({
                    filter: isFilter(v.filter) ? v.filter : "open",
                    sort: isSort(v.sort) ? v.sort : "due",
                    tag: v.tag,
                    text: v.text,
                  })
                }
              >
                {v.name}
              </FilterPill>
              <button
                type="button"
                aria-label={`Remove the view ${v.name}`}
                className="text-ink-muted hover:text-ink rounded-control p-1"
                onClick={() => usePreferences.getState().removeView(v.id)}
              >
                <XIcon size={11} aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}

      {statsOpen && tags.length > 0 && (
        <div
          id={statsId}
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label="Tags"
        >
          {tags.slice(0, 8).map((t) => (
            <button
              key={t.tag}
              type="button"
              onClick={() =>
                onViewChange({ ...view, tag: view.tag === t.tag ? null : t.tag })
              }
              className={cn(
                "rounded-chip text-ink-soft border-line bg-chip hover:text-accent-ink border px-2.5 py-1 text-[12px] font-semibold",
                view.tag === t.tag && "bg-accent-soft text-accent-ink",
              )}
              title={`${t.open} open, ${t.overdue} overdue, ${t.done} done`}
            >
              {t.tag} · {t.open} open{t.overdue > 0 ? `, ${t.overdue} overdue` : ""} ·{" "}
              {t.percent}%
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The bar that appears when to-dos are ticked: close, snooze, set priority, tag, cancel.
 *  `selected` is only the ticked to-dos that are on screen (see bulkSelection.ts): every
 *  action here, and its Undo, reaches those and nothing else. */
export function BulkBar({
  selected,
  summary,
  state,
  onClear,
  onDone,
  onSettled,
}: {
  selected: readonly Todo[];
  /** "2 ticked", or "1 ticked (1 more hidden by the filter, not included)". */
  summary: string;
  state: PmoState;
  /** "Clear selection": unticks everything, hidden rows too. */
  onClear: () => void;
  /** After an action: unticks the to-dos it was applied to (hidden ticks are kept). */
  onDone: (ids: string[]) => void;
  onSettled: () => void;
}) {
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const holidays = useHolidayDates(state.today);
  // Everything ticked is hidden by the filter: nothing to act on until a tick is on screen.
  const none = selected.length === 0;

  const run = async (action: BulkAction) => {
    const patches = bulkPatches(action, selected);
    if (patches.length === 0) {
      toast({ message: "Nothing to change for the ticked to-dos." });
      return;
    }
    const undo = bulkUndo(action, selected);
    const ids = selected.map((t) => t.id);
    setBusy(true);
    try {
      const replies = await Promise.all(patches.map((p) => patchTodo(p.id, p.patch)));
      const failed = replies.filter((r) => !r.ok).length;
      // Undo puts back only what really changed, not a patch the server refused.
      const undoApplied = appliedUndo(
        patches,
        undo,
        replies.map((r) => r.ok),
      );
      toast({
        key: "bulk",
        tone: failed > 0 ? "warning" : "success",
        message:
          failed > 0
            ? `${bulkSummary(action, patches.length - failed)} ${failed} could not be changed.`
            : bulkSummary(action, patches.length),
        action: {
          label: "Undo",
          run: () =>
            void Promise.all(undoApplied.map((p) => patchTodo(p.id, p.patch))).then(
              onSettled,
            ),
        },
      });
      onDone(ids);
      onSettled();
    } finally {
      setBusy(false);
    }
  };

  const tomorrow = () =>
    snoozeUntil(
      "tomorrow",
      new Date(state.serverTime),
      state.config.reminders,
      holidays,
    ).toISOString();

  return (
    <div
      role="toolbar"
      aria-label="Actions for the ticked to-dos"
      className={cn(CONTENT_WIDTH, GUTTER_X, "pt-2.5")}
    >
      <div className="bg-accent-soft rounded-card flex flex-wrap items-center gap-2 px-3.5 py-2.5">
        <span className="text-accent-ink mr-1 text-[13px] font-bold">{summary}</span>
        <Button
          size="sm"
          disabled={busy || none}
          onClick={() => void run({ type: "done" })}
        >
          Mark done
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || none}
          onClick={() => void run({ type: "snooze", until: tomorrow() })}
        >
          Snooze to tomorrow
        </Button>
        <NativeSelect
          value=""
          aria-label="Set priority"
          disabled={busy || none}
          className="max-w-32"
          onChange={(e) => {
            const priority = e.target.value as "high" | "normal" | "low";
            if (priority) void run({ type: "priority", priority });
          }}
        >
          <option value="">Priority…</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </NativeSelect>
        <Input
          value={tag}
          aria-label="Tag the ticked to-dos"
          placeholder="Add a tag"
          className="w-32"
          disabled={none}
          onChange={(e) => setTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && tag.trim() && !none) {
              void run({ type: "tag", tag }).then(() => setTag(""));
            }
          }}
        />
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || none}
          onClick={() => void run({ type: "cancel" })}
        >
          Cancel them
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
          Clear selection
        </Button>
      </div>
    </div>
  );
}
