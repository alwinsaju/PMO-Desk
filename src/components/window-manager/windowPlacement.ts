/**
 * Where a window starts: the size and spot it last had (ideas 110 and 111), else a
 * per-app default size, else the old cascade. Pure and import-light so `pnpm test` can
 * load it; windowStore.ts feeds it the live viewport and saved preferences.
 */
import {
  defaultWindowGeometry,
  fitRectToViewport,
  type FitConfig,
  type GeometryConfig,
  type Rect,
  type Viewport,
  type WindowGeometry,
} from "./windowGeometry.ts";

type Size = { width: number; height: number };

/** Apps whose content is wider or taller than the one shared default. Clamped to the screen. */
export const APP_DEFAULT_SIZES: Readonly<Record<string, Size>> = {
  dashboard: { width: 1240, height: 740 },
  templates: { width: 1240, height: 740 },
  staff: { width: 1280, height: 760 },
  tasks: { width: 1180, height: 720 },
};

/** Windows that are not "the" window of an app (each web app is its own place). */
const NOT_REMEMBERED: ReadonlySet<string> = new Set(["web-app"]);

export const isRemembered = (appId: string): boolean => !NOT_REMEMBERED.has(appId);

export interface StartingGeometryInput {
  appId: string;
  openCount: number;
  viewport: Viewport | null;
  config: GeometryConfig;
  fit: FitConfig;
  /** The saved rectangle for each app id. */
  remembered: Readonly<Record<string, Rect | undefined>>;
  /** Another window of this app is already open: cascade instead of landing on top of it. */
  sameAppOpen: boolean;
}

export function startingGeometry(input: StartingGeometryInput): WindowGeometry {
  const { appId, viewport, config } = input;
  const saved = isRemembered(appId) ? input.remembered[appId] : undefined;
  if (saved && viewport && !input.sameAppOpen) {
    const fitted = fitRectToViewport(saved, viewport, input.fit, config.minSize);
    return {
      position: { x: fitted.x, y: fitted.y },
      size: { width: fitted.width, height: fitted.height },
    };
  }
  const size = APP_DEFAULT_SIZES[appId] ?? config.size;
  return defaultWindowGeometry(input.openCount, viewport, { ...config, size });
}

export interface WindowLike {
  appId: string;
  position: { x: number; y: number };
  size: Size;
  isMaximized: boolean;
  isMinimized: boolean;
}

export interface PristineInput {
  windows: Readonly<Record<string, WindowLike>>;
  /** The position and size objects each window was given when it opened (by reference). */
  pristine: ReadonlyMap<string, { position: WindowLike["position"]; size: Size }>;
  viewport: Viewport | null;
  config: GeometryConfig;
  fit: FitConfig;
  remembered: Readonly<Record<string, Rect | undefined>>;
}

/**
 * The saved rectangles arrive a moment after the first windows may already be open (they
 * are read from the app's own server). A window that has not been moved or resized since
 * it opened is moved to where that app's window last was; one a person already placed is
 * left alone. At most one window per app, so two are never stacked on the same spot.
 */
export function pristineUpdates(
  input: PristineInput,
): { id: string; geometry: WindowGeometry }[] {
  const out: { id: string; geometry: WindowGeometry }[] = [];
  const done = new Set<string>();
  for (const [id, original] of input.pristine) {
    const w = input.windows[id];
    if (!w || w.isMaximized || w.isMinimized) continue;
    if (w.position !== original.position || w.size !== original.size) continue;
    if (!isRemembered(w.appId) || !input.remembered[w.appId] || done.has(w.appId))
      continue;
    done.add(w.appId);
    out.push({
      id,
      geometry: startingGeometry({
        appId: w.appId,
        openCount: 0,
        viewport: input.viewport,
        config: input.config,
        fit: input.fit,
        remembered: input.remembered,
        sameAppOpen: false,
      }),
    });
  }
  return out;
}

/**
 * The windows whose rectangle changed between two store snapshots and is worth saving.
 * A maximised or minimised window keeps its old rectangle (what a person set by hand).
 */
export function rectsToRemember(
  before: Readonly<Record<string, WindowLike>>,
  after: Readonly<Record<string, WindowLike>>,
): { appId: string; rect: Rect }[] {
  const out: { appId: string; rect: Rect }[] = [];
  for (const [id, w] of Object.entries(after)) {
    if (!isRemembered(w.appId) || w.isMaximized || w.isMinimized) continue;
    const old = before[id];
    // A window that has only just opened still has its default rectangle: nothing chosen yet.
    if (!old) continue;
    if (
      old.position === w.position &&
      old.size === w.size &&
      !old.isMaximized &&
      !old.isMinimized
    ) {
      continue;
    }
    out.push({ appId: w.appId, rect: { ...w.position, ...w.size } });
  }
  return out;
}
