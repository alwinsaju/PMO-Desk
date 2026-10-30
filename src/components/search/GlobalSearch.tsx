"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { fetchState } from "@/components/apps/pmo-todo-app/api";
import { useRemindersStore } from "@/components/apps/pmo-todo-app/remindersStore";
import { useStaffNav } from "@/components/apps/staff-app/staffNavStore";
import { fetchLibrary } from "@/components/apps/templates-app/api";
import { getNotes, noteTitle } from "@/components/apps/notes-app/notesStore";
import { builtInApps, toolApps } from "@/components/taskbar/pinnedApps";
import { fetchRegister } from "@/components/apps/toolkit/registersApi";
import { REGISTERS } from "@/lib/registers/defs";
import { recordTitle, textOf } from "@/lib/registers/records";
import { openOrFocusBuiltInApp } from "@/components/taskbar/launchBuiltInApp";
import { cn } from "@/lib/cn";
import {
  appItems,
  KIND_LABEL,
  noteItems,
  personItems,
  recordItems,
  searchItems,
  templateItems,
  timeOffItems,
  todoItems,
  type SearchItem,
} from "@/lib/search/searchIndex";
import { useStaffStore, useStaffSync } from "@/lib/staff/staffStore";

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
  const [loaded, setLoaded] = useState<{
    todos: SearchItem[];
    templates: SearchItem[];
    records: SearchItem[];
  }>({
    todos: [],
    templates: [],
    records: [],
  });
  const listRef = useRef<HTMLUListElement>(null);

  // Read the to-dos, templates and PMO tool records once when the box opens.
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      Promise.allSettled([fetchState(), fetchLibrary()]),
      Promise.allSettled(REGISTERS.map((def) => fetchRegister(def.id))),
    ]).then(([[state, library], registers]) => {
      if (cancelled) return;
      const records = registers.flatMap((result, index) => {
        const def = REGISTERS[index]!;
        if (result.status !== "fulfilled" || !result.value.ok) return [];
        return recordItems(
          { id: def.id, title: def.title },
          result.value.items.map((r) => ({
            id: r.id,
            title: recordTitle(def, r),
            subtitle: def.statusKey ? textOf(r, def.statusKey) : "",
            keywords: Object.values(r.values)
              .map((v) => (Array.isArray(v) ? v.join(" ") : String(v)))
              .join(" "),
          })),
        );
      });
      setLoaded({
        todos: state.status === "fulfilled" ? todoItems(state.value.todos) : [],
        templates:
          library.status === "fulfilled" && library.value.ok
            ? templateItems(library.value.templates)
            : [],
        records,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const items = useMemo(
    () => [
      ...appItems([...builtInApps, ...toolApps]),
      ...loaded.todos,
      ...loaded.records,
      ...personItems(employees),
      ...timeOffItems(timeOff, employees),
      ...loaded.templates,
      ...noteItems(
        getNotes().map((n) => ({
          id: n.id,
          title: noteTitle(n.content),
          content: n.content,
        })),
      ),
    ],
    [loaded, employees, timeOff],
  );
  const results = useMemo(() => searchItems(items, query), [items, query]);
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
            <li className="text-ink-muted px-3 py-6 text-center text-[13px]">
              Nothing matches “{query.trim()}”.
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
