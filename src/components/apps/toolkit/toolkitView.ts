// Pure logic for the Toolkit launcher: the filter box, pinned tools, and the per-viewer
// memory of both (browser localStorage, never throws). See toolkitView.test.mjs.

export interface ToolEntry {
  id: string;
  title: string;
  /** The register's one-line description, shown on the tile. */
  blurb?: string;
}

export interface ToolGroup<T> {
  title: string;
  tools: T[];
}

/** Title of the group of pinned tools that leads the launcher. */
export const PINNED_GROUP_TITLE = "Pinned";

/** Tools whose name or description contains every word typed, case-insensitively. A blank
 *  query keeps them all. */
export function filterTools<T extends ToolEntry>(
  tools: readonly T[],
  query: string,
): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...tools];
  return tools.filter((tool) => {
    const text = `${tool.title} ${tool.blurb ?? ""}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** Drops anything that is not a known tool id, and repeats, keeping the stored order. */
export function sanitizePinned(raw: unknown, knownIds: Iterable<string>): string[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(knownIds);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of raw) {
    if (typeof id !== "string" || !known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** A stored last-opened id, or null when it is not a known tool. */
export function sanitizeLastTool(
  raw: unknown,
  knownIds: Iterable<string>,
): string | null {
  if (typeof raw !== "string") return null;
  for (const id of knownIds) if (id === raw) return raw;
  return null;
}

/** Pins a tool at the end of the pinned list, or unpins it. Returns a new list. */
export function togglePin(pinned: readonly string[], id: string): string[] {
  return pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id];
}

/** Puts the pinned tools (in pin order) in a leading "Pinned" group and takes them out of
 *  their own groups. Groups left empty are dropped, so after filtering a group with no
 *  matches disappears. */
export function arrangeGroups<T extends { id: string }>(
  groups: readonly ToolGroup<T>[],
  pinned: readonly string[],
): ToolGroup<T>[] {
  const byId = new Map(groups.flatMap((g) => g.tools).map((tool) => [tool.id, tool]));
  const pinnedTools = pinned.flatMap((id) => {
    const tool = byId.get(id);
    return tool ? [tool] : [];
  });
  const pinnedIds = new Set(pinnedTools.map((tool) => tool.id));
  const rest = groups
    .map((g) => ({ title: g.title, tools: g.tools.filter((t) => !pinnedIds.has(t.id)) }))
    .filter((g) => g.tools.length > 0);
  return pinnedTools.length > 0
    ? [{ title: PINNED_GROUP_TITLE, tools: pinnedTools }, ...rest]
    : rest;
}

// --- Per-viewer memory -------------------------------------------------------------------

export const PINNED_KEY = "toolkit:pinned";
export const LAST_TOOL_KEY = "toolkit:last";

/** The slice of `Storage` used here, so tests can pass a fake (or one that throws). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The browser's localStorage, or null when it is missing or the accessor throws. */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The remembered pins and last tool, checked against the known tool ids. Anything
 *  unreadable (no storage, a throw, bad JSON) gives no pins and no last tool. */
export function loadToolkitMemory(
  storage: StorageLike | null,
  knownIds: readonly string[],
): { pinned: string[]; last: string | null } {
  let pinned: string[] = [];
  let last: string | null = null;
  try {
    const raw = storage?.getItem(PINNED_KEY);
    if (raw) pinned = sanitizePinned(JSON.parse(raw), knownIds);
  } catch {
    pinned = [];
  }
  try {
    last = sanitizeLastTool(storage?.getItem(LAST_TOOL_KEY), knownIds);
  } catch {
    last = null;
  }
  return { pinned, last };
}

/** Remembers the pinned ids. Returns false when it could not be saved (it is then just not remembered). */
export function savePinned(
  storage: StorageLike | null,
  pinned: readonly string[],
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(PINNED_KEY, JSON.stringify(pinned));
    return true;
  } catch {
    return false;
  }
}

/** Remembers the last-opened tool id. Returns false when it could not be saved. */
export function saveLastTool(storage: StorageLike | null, id: string): boolean {
  try {
    if (!storage) return false;
    storage.setItem(LAST_TOOL_KEY, id);
    return true;
  } catch {
    return false;
  }
}
