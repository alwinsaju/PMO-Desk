"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { create } from "zustand";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useRemindersStore } from "@/components/apps/pmo-todo-app/remindersStore";
import { useStaffNav } from "@/components/apps/staff-app/staffNavStore";
import { getNotes, noteTitle } from "@/components/apps/notes-app/notesStore";
import { builtInApps, toolApps } from "@/components/taskbar/pinnedApps";
import { openOrFocusBuiltInApp } from "@/components/taskbar/launchBuiltInApp";
import { cn } from "@/lib/cn";
import {
  appItems,
  KIND_LABEL,
  noteItems,
  personItems,
  searchItems,
  timeOffItems,
  type SearchItem,
} from "@/lib/search/searchIndex";
import { emptyStateFor, loadedItems, sourceProblems } from "@/lib/search/searchSources";
import { useStaffStore, useStaffSync } from "@/lib/staff/staffStore";
import {
  OPEN_MAX_AGE_MS,
  PREFETCH_MAX_AGE_MS,
  searchSources,
} from "./searchSourcesStore";

interface SearchUi {
  open: boolean;
  show: () => void;
  hide: () => void;
}

/** Opening and closing the search from anywhere (the shortcut sheet and menus use it too). */
export const useSearchUi = create<SearchUi>()((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

function choose(item: SearchItem): void {
  const { target } = item;
  openOrFocusBuiltInApp(target.app);
  if ("todoId" in target) {
    useRemindersStore.getState().requestOpen(target.todoId);
  } else if ("tab" in target) {
    useStaffNav.getState().requestOpen({
      tab: target.tab,
      ...(target.tab === "timeoff" ? { timeOffStatus: "" as const } : {}),
    });
  }
}

function SearchPanel({ onClose }: { onClose: () => void }) {
  useStaffSync();
  const employees = useStaffStore((s) => s.employees);
  const timeOff = useStaffStore((s) => s.timeOff);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const sources = useSyncExternalStore(
    searchSources.subscribe,
    searchSources.getState,
    searchSources.getState,
  );
  const listRef = useRef<HTMLUListElement>(null);

  // Refresh in the background on open; what is already cached shows straight away.
  useEffect(() => {
    void searchSources.ensure(OPEN_MAX_AGE_MS);
  }, []);

  const items = useMemo(
    () => [
      ...appItems([...builtInApps, ...toolApps]),
      ...loadedItems(sources),
      ...personItems(employees),
      ...timeOffItems(timeOff, employees),
      ...noteItems(
        getNotes().map((n) => ({
          id: n.id,
          title: noteTitle(n.content),
          content: n.content,
        })),
      ),
    ],
    [sources, employees, timeOff],
  );
  const results = useMemo(() => searchItems(items, query), [items, query]);
  const problems = useMemo(() => sourceProblems(sources), [sources]);
  const empty = useMemo(() => emptyStateFor(sources, query), [sources, query]);
  const current = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => {
    listRef.current?.children[current]?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const pick = (item: SearchItem | undefined) => {
    if (!item) return;
    onClose();
    choose(item);
  };

  return (
    <div
      className="fixed inset-0 z-[var(--z-overlay)] flex items-start justify-center bg-black/25 pt-[14vh]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-label="Search"
        className="glass-pop rounded-card flex max-h-[60vh] w-[min(36rem,92vw)] flex-col overflow-hidden"
      >
        <div className="border-line flex items-center gap-2.5 border-b px-4 py-3">
          <MagnifyingGlassIcon
            size={18}
            className="text-ink-muted shrink-0"
            aria-hidden
          />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive(Math.min(current + 1, results.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive(Math.max(current - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                pick(results[current]);
              }
            }}
            aria-label="Search everything"
            placeholder="Search to-dos, people, time off, templates, notes and apps"
            role="combobox"
            aria-expanded
            aria-controls="global-search-results"
            aria-activedescendant={
              results[current] ? `search-${results[current].id}` : undefined
            }
            className="text-ink placeholder:text-ink-muted min-w-0 flex-1 bg-transparent text-[15px] font-medium outline-none"
          />
        </div>
        <ul
          id="global-search-results"
          ref={listRef}
          role="listbox"
          className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5"
        >
          {results.length === 0 ? (
            <li
              role="status"
              className="text-ink-muted px-3 py-6 text-center text-[13px]"
            >
              {empty.text}
            </li>
          ) : (
            results.map((item, index) => (
              <li
                key={item.id}
                id={`search-${item.id}`}
                role="option"
                aria-selected={index === current}
                onMouseMove={() => setActive(index)}
                onClick={() => pick(item)}
                className={cn(
                  "rounded-control flex cursor-pointer items-center gap-3 px-3 py-2",
                  index === current && "bg-accent-soft",
                )}
              >
                <span className="bg-chip text-ink-soft rounded-control shrink-0 px-2 py-0.5 text-[11px] font-semibold">
                  {KIND_LABEL[item.kind]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-ink block truncate text-[13.5px] font-semibold">
                    {item.title}
                  </span>
                  {item.subtitle && (
                    <span className="text-ink-muted block truncate text-[12px]">
                      {item.subtitle}
                    </span>
                  )}
                </span>
              </li>
            ))
          )}
        </ul>
        {problems.length > 0 && (
          <div
            role="alert"
            className="border-line text-amber flex items-start justify-between gap-3 border-t px-4 py-2 text-[12px]"
          >
            <span className="min-w-0">{problems.join(". ")}</span>
            <button
              type="button"
              onClick={() => void searchSources.ensure(0)}
              className="text-accent-ink shrink-0 font-semibold hover:underline"
            >
              Try again
            </button>
          </div>
        )}{" "}
        <p className="border-line text-ink-faint border-t px-4 py-2 text-[11.5px]">
          ↑ ↓ to move · Enter to open · Esc to close
        </p>
      </div>
    </div>
  );
}

/** Ctrl+K opens a search over apps, to-dos, people, time off, templates and notes. */
export function GlobalSearch() {
  const open = useSearchUi((s) => s.open);
  const hide = useSearchUi((s) => s.hide);
  // Load the slow sources shortly after start so the first Ctrl+K already has them.
  useEffect(() => {
    const timer = setTimeout(() => void searchSources.ensure(PREFETCH_MAX_AGE_MS), 4000);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        const ui = useSearchUi.getState();
        if (ui.open) ui.hide();
        else ui.show();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return open ? <SearchPanel onClose={hide} /> : null;
}
