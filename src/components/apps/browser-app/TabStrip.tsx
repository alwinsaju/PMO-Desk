"use client";

import type { KeyboardEvent } from "react";
import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { MAX_TABS, currentEntry, tabTitle, type TabsState } from "./browserTabs";

/** The tab strip: one button per tab with a close button, and "+" for a new tab. */
export function TabStrip({
  state,
  onSelect,
  onClose,
  onNew,
}: {
  state: TabsState;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  const move = (event: KeyboardEvent, index: number) => {
    const last = state.tabs.length - 1;
    const next =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : null;
    if (next === null) return;
    event.preventDefault();
    onSelect(state.tabs[next].id);
    document.getElementById(`browser-tab-${state.tabs[next].id}`)?.focus();
  };

  return (
    <div className="px-gutter flex items-end gap-1 pt-1" data-testid="browser-tabs">
      <div role="tablist" aria-label="Tabs" className="flex min-w-0 items-end gap-1">
        {state.tabs.map((tab, index) => {
          const active = tab.id === state.activeId;
          const title = tabTitle(currentEntry(tab));
          return (
            <div
              key={tab.id}
              className={cn(
                "rounded-t-control group flex max-w-[200px] min-w-0 items-center transition-colors",
                active ? "bg-chip-strong" : "hover:bg-chip",
              )}
            >
              <button
                type="button"
                role="tab"
                id={`browser-tab-${tab.id}`}
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                data-testid="browser-tab"
                onClick={() => onSelect(tab.id)}
                onKeyDown={(event) => move(event, index)}
                className={cn(
                  "focus-ring min-w-0 flex-1 truncate rounded-md py-1.5 pr-1 pl-3 text-left text-[12.5px]",
                  active ? "text-ink font-semibold" : "text-ink-muted",
                )}
              >
                {title}
              </button>
              <IconButton
                aria-label={`Close ${title}`}
                size="sm"
                shape="round"
                className="mr-1 h-6 w-6 shrink-0"
                onClick={() => onClose(tab.id)}
              >
                <XIcon size={12} weight="bold" />
              </IconButton>
            </div>
          );
        })}
      </div>
      <IconButton
        aria-label="New tab"
        size="sm"
        disabled={state.tabs.length >= MAX_TABS}
        title={
          state.tabs.length >= MAX_TABS
            ? `You can have ${MAX_TABS} tabs open. Close one to open another.`
            : "New tab"
        }
        onClick={onNew}
        className="mb-0.5"
      >
        <PlusIcon />
      </IconButton>
    </div>
  );
}
