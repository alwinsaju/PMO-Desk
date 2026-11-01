// The Browser's tabs as pure state: each tab has its own back/forward history. See browserTabs.test.mjs.
import { mockPageMeta, type MockPageId } from "./mockPages.ts";

/** One history entry: a static "Pathfinder" page, a real url, a search handed to the OS browser, or the new-tab page. */
export type NavEntry =
  | { kind: "mock"; id: MockPageId }
  | { kind: "url"; url: string }
  | { kind: "search"; url: string; query: string }
  | { kind: "newtab" };

export interface Tab {
  id: string;
  history: NavEntry[];
  index: number;
  /** Bumped by Reload and Retry so a real page loads afresh. */
  reloads: number;
}

export interface TabsState {
  tabs: Tab[];
  activeId: string;
}

export const MAX_TABS = 8;

const MOCK_TITLES: Record<MockPageId, string> = {
  home: "Pathfinder",
  wiki: "Window managers",
  about: "About Pathfinder",
};

export const newTab = (id: string, entry: NavEntry): Tab => ({
  id,
  history: [entry],
  index: 0,
  reloads: 0,
});

export const createTabs = (id: string, entry: NavEntry): TabsState => ({
  tabs: [newTab(id, entry)],
  activeId: id,
});

export const activeTab = (state: TabsState): Tab =>
  state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0];

export const currentEntry = (tab: Tab): NavEntry => tab.history[tab.index];

export function tabTitle(entry: NavEntry): string {
  switch (entry.kind) {
    case "mock":
      return MOCK_TITLES[entry.id];
    case "newtab":
      return "New tab";
    case "search":
      return entry.query.length > 24 ? `${entry.query.slice(0, 23)}…` : entry.query;
    case "url":
      try {
        return new URL(entry.url).hostname.replace(/^www\./, "") || entry.url;
      } catch {
        return entry.url;
      }
  }
}

/** The address bar text for an entry; empty for the new-tab page. */
export function entryAddress(entry: NavEntry): string {
  if (entry.kind === "mock") return mockPageMeta[entry.id].url;
  return entry.kind === "newtab" ? "" : entry.url;
}

/** Opens a tab right after the active one and makes it active; nothing happens at MAX_TABS. */
export function openTab(state: TabsState, id: string, entry: NavEntry): TabsState {
  if (state.tabs.length >= MAX_TABS) return state;
  const at = state.tabs.findIndex((t) => t.id === state.activeId) + 1;
  const tabs = [...state.tabs];
  tabs.splice(at, 0, newTab(id, entry));
  return { tabs, activeId: id };
}

/** Closes a tab; the one next to it takes over, and closing the last tab leaves a fresh new-tab page. */
export function closeTab(state: TabsState, id: string, freshId: string): TabsState {
  const index = state.tabs.findIndex((t) => t.id === id);
  if (index === -1) return state;
  if (state.tabs.length === 1) return createTabs(freshId, { kind: "newtab" });
  const tabs = state.tabs.filter((t) => t.id !== id);
  const activeId =
    state.activeId === id ? tabs[Math.min(index, tabs.length - 1)].id : state.activeId;
  return { tabs, activeId };
}

export const selectTab = (state: TabsState, id: string): TabsState =>
  state.tabs.some((t) => t.id === id) ? { ...state, activeId: id } : state;

/** Applies a change to one tab. */
export function updateTab(
  state: TabsState,
  id: string,
  change: (tab: Tab) => Tab,
): TabsState {
  return { ...state, tabs: state.tabs.map((t) => (t.id === id ? change(t) : t)) };
}

/** A new page in a tab: anything ahead in its history is dropped. */
export const pushEntry = (tab: Tab, entry: NavEntry): Tab => ({
  ...tab,
  history: [...tab.history.slice(0, tab.index + 1), entry],
  index: tab.index + 1,
});

export const goBack = (tab: Tab): Tab => ({ ...tab, index: Math.max(0, tab.index - 1) });

export const goForward = (tab: Tab): Tab => ({
  ...tab,
  index: Math.min(tab.history.length - 1, tab.index + 1),
});

export const reloadTab = (tab: Tab): Tab => ({ ...tab, reloads: tab.reloads + 1 });
