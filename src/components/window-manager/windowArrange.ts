/**
 * Whole-desktop window actions from the dock menu: "Show desktop" (minimise everything)
 * and "Tidy windows" (put every visible window back on a fresh cascade). Pure and
 * import-light so `pnpm test` can load it; windowStore.ts feeds it the live state and
 * writes the result in ONE store update (the same "commit once" rule as drag and resize).
 */
import type {
  FitConfig,
  GeometryConfig,
  Viewport,
  WindowGeometry,
} from "./windowGeometry.ts";
import { startingGeometry } from "./windowPlacement.ts";

interface Placed {
  id: string;
  appId: string;
  zIndex: number;
  isMinimized: boolean;
  isMaximized: boolean;
  isFocused: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  minSize?: { width: number; height: number };
  restoreBounds?: unknown;
}

/** True while at least one window is on screen (not minimised). */
export const hasVisibleWindow = (windows: Readonly<Record<string, Placed>>): boolean =>
  Object.values(windows).some((w) => !w.isMinimized);

/**
 * Every window minimised and none focused, in one pass. Looping `minimizeWindow` would
 * hand focus to the next window after each one; here nothing is refocused. Windows that
 * are already minimised keep their object, and the SAME record comes back when there is
 * nothing to minimise, so the store can skip the update.
 */
export function minimizeAll<T extends Placed>(
  windows: Readonly<Record<string, T>>,
): Readonly<Record<string, T>> {
  let next: Record<string, T> | null = null;
  for (const [id, w] of Object.entries(windows)) {
    if (w.isMinimized && !w.isFocused) continue;
    next ??= { ...windows };
    next[id] = { ...w, isMinimized: true, isFocused: false } as T;
  }
  return next ?? windows;
}

/**
 * Where each visible window goes on "Tidy windows": the default geometry for its app
 * (the per-app default size, else the shared one), called once per window with the window's
 * place in the stack as the cascade index, so the topmost window ends up in front on the
 * last step. Saved rectangles are ignored on purpose (that is the point of tidying), a
 * window never goes below its own minimum size, and minimised windows are left alone.
 */
export function tidyUpdates(
  windows: Readonly<Record<string, Placed>>,
  viewport: Viewport | null,
  config: GeometryConfig,
  fit: FitConfig,
): { id: string; geometry: WindowGeometry }[] {
  const visible = Object.values(windows)
    .filter((w) => !w.isMinimized)
    .sort((a, b) => a.zIndex - b.zIndex);
  return visible.map((w, index) => {
    const base = startingGeometry({
      appId: w.appId,
      openCount: index,
      viewport,
      config,
      fit,
      remembered: {},
      sameAppOpen: false,
    });
    const min = w.minSize ?? config.minSize;
    return {
      id: w.id,
      geometry: {
        position: base.position,
        size: {
          width: Math.max(min.width, base.size.width),
          height: Math.max(min.height, base.size.height),
        },
      },
    };
  });
}

/** The windows record after tidying: each visible window at its new rectangle and no longer
 *  maximised. Focus and stacking stay as they were. Same record back when nothing changes. */
export function applyTidy<T extends Placed>(
  windows: Readonly<Record<string, T>>,
  updates: readonly { id: string; geometry: WindowGeometry }[],
): Readonly<Record<string, T>> {
  let next: Record<string, T> | null = null;
  for (const { id, geometry } of updates) {
    const w = windows[id];
    if (!w) continue;
    const unchanged =
      !w.isMaximized &&
      w.position.x === geometry.position.x &&
      w.position.y === geometry.position.y &&
      w.size.width === geometry.size.width &&
      w.size.height === geometry.size.height;
    if (unchanged) continue;
    next ??= { ...windows };
    next[id] = {
      ...w,
      isMaximized: false,
      restoreBounds: undefined,
      position: geometry.position,
      size: geometry.size,
    } as T;
  }
  return next ?? windows;
}
