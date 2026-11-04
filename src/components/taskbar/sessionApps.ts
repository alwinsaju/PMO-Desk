/**
 * Pure rules for "Reopen last session's apps": which apps count as open (what gets
 * remembered) and which of the remembered ones are opened at launch. Import-free so
 * `pnpm test` can load it; sessionRestore.ts does the wiring to the stores.
 */

/** The generic web-app window is one window kind for many catalog apps, so it has no id of
 *  its own to remember (a web app's URL is not stored). */
const NOT_REMEMBERED = new Set(["web-app"]);

/** Ids kept per session at most (the same limit the saved preference uses). */
export const MAX_SESSION_APPS = 16;

/**
 * The apps to remember, bottom to top: one id per app (an app with several windows counts
 * once, at its highest window), in stacking order, so reopening in this order puts the
 * window that was in front in front again. Only ids in `restorable` are kept, so the list
 * never fills with something launch cannot open.
 */
export function sessionAppIds(
  windows: Readonly<Record<string, { appId: string; zIndex: number }>>,
  restorable: ReadonlySet<string>,
): string[] {
  const top = new Map<string, number>();
  for (const w of Object.values(windows)) {
    if (NOT_REMEMBERED.has(w.appId) || !restorable.has(w.appId)) continue;
    top.set(w.appId, Math.max(top.get(w.appId) ?? -Infinity, w.zIndex));
  }
  return [...top.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id)
    .slice(-MAX_SESSION_APPS);
}

/**
 * What to open at launch from the remembered list: ids that can still be opened (an app
 * that was removed since is skipped), once each, and not an app that already has a window
 * (something opened it before the restore ran). Order is kept.
 */
export function appsToRestore(
  saved: readonly unknown[],
  restorable: ReadonlySet<string>,
  alreadyOpen: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const id of saved) {
    if (typeof id !== "string" || !restorable.has(id) || alreadyOpen.has(id)) continue;
    if (out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_SESSION_APPS) break;
  }
  return out;
}

export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
