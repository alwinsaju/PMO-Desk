/**
 * Pure list logic for the user-editable taskbar — which apps are pinned,
 * in what order, and which extra tiles appear because a window is open.
 *
 * Deliberately import-free and framework-agnostic (no React, no zustand, no
 * icon values, no path aliases): `pnpm test` imports this file straight into
 * Node's test runner (see taskbarLayout.test.mjs), and `pinnedAppsStore.ts`
 * is a thin wrapper that just feeds these functions the live state. Every
 * function is immutable — it returns a new array (or the SAME reference when
 * nothing changed, so a store can cheaply skip a no-op update).
 *
 * An "app id" here is either a built-in app's id (`pinnedApps.ts`'s
 * `builtInApps`) or an App Store catalog entry's id (`appCatalog.ts`) — the
 * two id spaces don't collide, so one flat ordered list covers both.
 */

export interface TaskbarItem {
  id: string;
  /** False for a tile shown only because a window of an unpinned app is
   *  open — it goes away when that window closes. */
  pinned: boolean;
}

/** The persisted layout: the ordered pinned list plus the built-ins it has
 *  already "accounted for" (see `reconcileBuiltIns`). */
export interface TaskbarLayout {
  pinnedIds: string[];
  knownBuiltInIds: string[];
}

/** The taskbar a fresh install (or "Reset taskbar to default") shows: every
 *  built-in, in `builtInApps` order. */
export function defaultPinnedIds(builtInIds: readonly string[]): string[] {
  return [...builtInIds];
}

export function defaultLayout(builtInIds: readonly string[]): TaskbarLayout {
  return {
    pinnedIds: defaultPinnedIds(builtInIds),
    knownBuiltInIds: [...builtInIds],
  };
}

/** True when the pinned list is exactly the default (same ids, same order). */
export function isDefaultPinnedIds(
  pinnedIds: readonly string[],
  builtInIds: readonly string[],
): boolean {
  return (
    pinnedIds.length === builtInIds.length &&
    pinnedIds.every((id, index) => id === builtInIds[index])
  );
}

/** Coerces untrusted persisted data into a clean id list: non-strings,
 *  empty strings and duplicates are dropped, first occurrence wins. Returns
 *  `null` when `raw` isn't an array at all (so callers can fall back to the
 *  default layout rather than treating garbage as "the user unpinned
 *  everything"). */
export function sanitizeIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string" || value === "" || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Appends `id` (no-op if already pinned). */
export function pinId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? (ids as string[]) : [...ids, id];
}

/** Removes `id` (no-op if not pinned). */
export function unpinId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((existing) => existing !== id) : (ids as string[]);
}

/**
 * Puts `id` immediately before (or, with `after`, after) `targetId` —
 * pinning it if it wasn't in the list yet, moving it if it was. This one
 * function is both "drag a tile to reorder" and "drop an App Menu app onto a
 * specific spot". Dropping an id onto itself, or onto a target that isn't in
 * the list, leaves an already-pinned id where it is / appends a new one.
 */
export function placeId(
  ids: readonly string[],
  id: string,
  targetId: string,
  after = false,
): string[] {
  if (id === targetId) return pinId(ids, id);
  const rest = ids.filter((existing) => existing !== id);
  const targetIndex = rest.indexOf(targetId);
  if (targetIndex === -1) return ids.includes(id) ? (ids as string[]) : [...rest, id];
  const insertAt = after ? targetIndex + 1 : targetIndex;
  const next = [...rest.slice(0, insertAt), id, ...rest.slice(insertAt)];
  const unchanged = next.length === ids.length && next.every((v, i) => v === ids[i]);
  return unchanged ? (ids as string[]) : next;
}

/**
 * Makes a (possibly old) saved layout aware of the CURRENT built-in apps:
 * any built-in that wasn't in `knownBuiltInIds` — i.e. was added to
 * `builtInApps` in code after this layout was saved — is appended to the
 * pinned list exactly once, then recorded as known. Without this, adding a
 * built-in app later would only ever reach brand-new installs, never anyone
 * who had already saved a (customized) taskbar. A built-in the user later
 * unpins stays unpinned because it is, by then, known.
 */
export function reconcileBuiltIns(
  layout: TaskbarLayout,
  builtInIds: readonly string[],
): TaskbarLayout {
  const fresh = builtInIds.filter(
    (id) => !layout.knownBuiltInIds.includes(id) && !layout.pinnedIds.includes(id),
  );
  const known = [...builtInIds];
  const knownUnchanged =
    known.length === layout.knownBuiltInIds.length &&
    known.every((id, index) => id === layout.knownBuiltInIds[index]);
  if (fresh.length === 0 && knownUnchanged) return layout;
  return { pinnedIds: [...layout.pinnedIds, ...fresh], knownBuiltInIds: known };
}

/**
 * Upgrades the first persisted shape (`{ pinnedIds }` holding ONLY the extra
 * App Store pins, with the 5 built-ins implicitly always present before
 * them) to the current one, so people who pinned apps under the old
 * "fixed baseline" keep exactly the taskbar they had.
 */
export function migrateLegacyPinned(
  legacyExtraIds: unknown,
  builtInIds: readonly string[],
): TaskbarLayout {
  const extras = sanitizeIds(legacyExtraIds) ?? [];
  return {
    pinnedIds: [...builtInIds, ...extras.filter((id) => !builtInIds.includes(id))],
    knownBuiltInIds: [...builtInIds],
  };
}

/**
 * The tiles to render, left to right: every pinned app in pinned order,
 * then — in the order their windows were opened — any app that has an open
 * window but isn't pinned (shown only while a window is open). `openIds` may
 * contain duplicates (several windows of one app) and ids that are already
 * pinned; both collapse.
 */
export function buildTaskbarItems(
  pinnedIds: readonly string[],
  openIds: readonly string[],
): TaskbarItem[] {
  const items: TaskbarItem[] = pinnedIds.map((id) => ({ id, pinned: true }));
  const seen = new Set(pinnedIds);
  for (const id of openIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ id, pinned: false });
  }
  return items;
}

/** Maps a window to the taskbar app id it belongs to: a real web app opens
 *  as the generic `web-app` window and is identified by its URL; every other
 *  window's `appId` already IS the app id. `undefined` when there's no
 *  matching taskbar app (the window just doesn't get a tile). */
export function appIdForWindow(
  window: { appId: string; url?: string },
  appIdByUrl: ReadonlyMap<string, string>,
  knownAppIds: ReadonlySet<string>,
): string | undefined {
  if (window.appId === "web-app") {
    return window.url === undefined ? undefined : appIdByUrl.get(window.url);
  }
  return knownAppIds.has(window.appId) ? window.appId : undefined;
}
