// "Recent" items in a dock tile's right-click menu (q-22): the last few to-dos or templates
// opened, newest first. Pure list upkeep and storage helpers; dockRecentsStore.ts keeps the
// live copy. Per-viewer only (this browser's localStorage), so every read and write is
// guarded: with no storage, or storage that throws, the list is simply not remembered.

export interface DockRecent {
  id: string;
  title: string;
}

/** Recent items by app id (only the apps in `DOCK_RECENT_APPS` have any). */
export type DockRecentsMap = Record<string, DockRecent[]>;

/** The apps whose dock menu has a Recent list. */
export const DOCK_RECENT_APPS = ["pmo-todo", "templates"] as const;

export const MAX_DOCK_RECENTS = 4;
const MAX_TITLE = 80;
export const DOCK_RECENTS_KEY = "dock:recents";

export const isDockRecentApp = (appId: string): boolean =>
  (DOCK_RECENT_APPS as readonly string[]).includes(appId);

const clipTitle = (title: string): string => {
  const clean = title.replace(/\s+/g, " ").trim();
  return clean.length > MAX_TITLE ? `${clean.slice(0, MAX_TITLE - 1)}…` : clean;
};

/** `entry` as the newest; opening it again moves it to the front and refreshes its title.
 *  An entry with no id or no title is ignored. */
export function pushDockRecent(
  list: readonly DockRecent[],
  entry: DockRecent,
  max = MAX_DOCK_RECENTS,
): DockRecent[] {
  const title = clipTitle(entry.title);
  if (!entry.id || !title) return [...list];
  return [{ id: entry.id, title }, ...list.filter((r) => r.id !== entry.id)].slice(
    0,
    max,
  );
}

/** Checks the list against what exists now: a gone item drops out, a renamed one shows its
 *  new title. `lookup` gives the current title of an id, or undefined when it is gone.
 *  Returns the same array when nothing changed. */
export function syncDockRecents(
  list: readonly DockRecent[],
  lookup: (id: string) => string | undefined,
): readonly DockRecent[] {
  let changed = false;
  const next: DockRecent[] = [];
  for (const item of list) {
    const current = lookup(item.id);
    const title = current === undefined ? "" : clipTitle(current);
    if (!title) {
      changed = true;
      continue;
    }
    if (title !== item.title) changed = true;
    next.push(title === item.title ? item : { id: item.id, title });
  }
  return changed ? next : list;
}

/** Reads a saved value back: only known apps, well-formed entries, no repeats, capped. */
export function sanitizeDockRecents(
  raw: unknown,
  max = MAX_DOCK_RECENTS,
): DockRecentsMap {
  const out: DockRecentsMap = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const appId of DOCK_RECENT_APPS) {
    const list = (raw as Record<string, unknown>)[appId];
    if (!Array.isArray(list)) continue;
    const seen = new Set<string>();
    const kept: DockRecent[] = [];
    for (const item of list) {
      if (typeof item !== "object" || item === null) continue;
      const { id, title } = item as Record<string, unknown>;
      if (typeof id !== "string" || typeof title !== "string") continue;
      const clipped = clipTitle(title);
      if (!id || !clipped || seen.has(id)) continue;
      seen.add(id);
      kept.push({ id, title: clipped });
    }
    if (kept.length > 0) out[appId] = kept.slice(0, max);
  }
  return out;
}

/** The slice of `Storage` used here, so tests can pass a fake (or one that throws). */
export interface RecentsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The browser's localStorage, or null when it is missing or the accessor throws. */
export function recentsStorage(): RecentsStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The remembered recents. Anything unreadable (no storage, a throw, bad JSON) gives none. */
export function loadDockRecents(storage: RecentsStorage | null): DockRecentsMap {
  try {
    const raw = storage?.getItem(DOCK_RECENTS_KEY);
    return raw ? sanitizeDockRecents(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

/** Remembers the recents. Returns false when it could not be saved (they are then just not kept). */
export function saveDockRecents(
  storage: RecentsStorage | null,
  recents: DockRecentsMap,
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(DOCK_RECENTS_KEY, JSON.stringify(recents));
    return true;
  } catch {
    return false;
  }
}
