/**
 * Named workspace layouts (ux-6): save the open apps and where their windows are under a
 * name, then bring that arrangement back. Pure and import-light so `pnpm test` can load it;
 * workspaceLayoutActions.ts does the wiring to the window and preferences stores.
 *
 * What a layout holds (see `WorkspaceLayout` in lib/preferences/schema.ts): one entry per
 * app, bottom to top, each with the rectangle of that app's topmost window. A maximised
 * window is saved at the rectangle it returns to when un-maximised, and comes back as an
 * ordinary window there. Restoring never closes anything; a window the layout does not
 * mention stays as it is (or is minimised, when the person ticks that choice).
 */
import {
  fitRectToViewport,
  type FitConfig,
  type Viewport,
  type WindowGeometry,
} from "../window-manager/windowGeometry.ts";
import {
  MAX_LAYOUT_NAME,
  MAX_LAYOUT_WINDOWS,
  MAX_WORKSPACE_LAYOUTS,
  sanitizeWindowRect,
  type WorkspaceLayout,
  type WorkspaceLayoutWindow,
} from "../../lib/preferences/schema.ts";
import { sessionAppIds } from "./sessionApps.ts";

type Size = { width: number; height: number };

// --- Names and the list ---------------------------------------------------------------

export type NameCheck = { ok: true; name: string } | { ok: false; reason: string };

/**
 * A name a person typed -> the name to store: trimmed, inner runs of spaces collapsed, not
 * empty, at most MAX_LAYOUT_NAME characters, and not used by another layout (case ignored).
 * `except` is the layout being renamed, so it may keep its name or only change its case.
 */
export function checkLayoutName(
  raw: string,
  layouts: readonly WorkspaceLayout[],
  except?: string,
): NameCheck {
  const name = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!name) return { ok: false, reason: "Type a name for the layout." };
  if (name.length > MAX_LAYOUT_NAME) {
    return { ok: false, reason: `Use ${MAX_LAYOUT_NAME} characters or fewer.` };
  }
  const taken = layouts.some(
    (l) =>
      l.name.toLowerCase() === name.toLowerCase() &&
      (except === undefined || l.name !== except),
  );
  if (taken) return { ok: false, reason: "A layout with that name already exists." };
  return { ok: true, name };
}

export type LayoutsResult =
  { ok: true; layouts: WorkspaceLayout[]; name: string } | { ok: false; reason: string };

/** Add a layout (at the end). Refused when the name is not usable, there is nothing to save,
 *  or MAX_WORKSPACE_LAYOUTS are already saved: nothing is replaced or dropped silently. */
export function saveWorkspaceLayout(
  layouts: readonly WorkspaceLayout[],
  rawName: string,
  windows: readonly WorkspaceLayoutWindow[],
): LayoutsResult {
  if (windows.length === 0) {
    return { ok: false, reason: "Open at least one app first, then save the layout." };
  }
  const checked = checkLayoutName(rawName, layouts);
  if (!checked.ok) return checked;
  if (layouts.length >= MAX_WORKSPACE_LAYOUTS) {
    return {
      ok: false,
      reason: `You can keep ${MAX_WORKSPACE_LAYOUTS} layouts. Delete one to save another.`,
    };
  }
  const kept = windows.slice(-MAX_LAYOUT_WINDOWS).map((w) => ({
    appId: w.appId,
    rect: { ...w.rect },
  }));
  return {
    ok: true,
    name: checked.name,
    layouts: [...layouts, { name: checked.name, windows: kept }],
  };
}

export function renameWorkspaceLayout(
  layouts: readonly WorkspaceLayout[],
  from: string,
  rawName: string,
): LayoutsResult {
  if (!layouts.some((l) => l.name === from)) {
    return { ok: false, reason: "That layout no longer exists." };
  }
  const checked = checkLayoutName(rawName, layouts, from);
  if (!checked.ok) return checked;
  return {
    ok: true,
    name: checked.name,
    layouts: layouts.map((l) => (l.name === from ? { ...l, name: checked.name } : l)),
  };
}

export const deleteWorkspaceLayout = (
  layouts: readonly WorkspaceLayout[],
  name: string,
): WorkspaceLayout[] => layouts.filter((l) => l.name !== name);

// --- Capture --------------------------------------------------------------------------

export interface CapturableWindow {
  appId: string;
  zIndex: number;
  isMaximized: boolean;
  position: { x: number; y: number };
  size: Size;
  restoreBounds?: { position: { x: number; y: number }; size: Size };
}

/**
 * The layout of the desktop as it is: one entry per restorable app (web apps and anything
 * launch cannot open are left out, the same rule as "Reopen my apps"), bottom to top, at the
 * rectangle of that app's topmost window. Minimised windows count as open. At most
 * MAX_LAYOUT_WINDOWS, keeping the ones in front.
 */
export function captureLayoutWindows(
  windows: Readonly<Record<string, CapturableWindow>>,
  restorable: ReadonlySet<string>,
): WorkspaceLayoutWindow[] {
  const out: WorkspaceLayoutWindow[] = [];
  for (const appId of sessionAppIds(windows, restorable)) {
    let top: CapturableWindow | undefined;
    for (const w of Object.values(windows)) {
      if (w.appId === appId && (!top || w.zIndex > top.zIndex)) top = w;
    }
    if (!top) continue;
    const bounds =
      top.isMaximized && top.restoreBounds
        ? top.restoreBounds
        : { position: top.position, size: top.size };
    const rect = sanitizeWindowRect({ ...bounds.position, ...bounds.size });
    if (rect) out.push({ appId, rect });
  }
  return out.slice(-MAX_LAYOUT_WINDOWS);
}

// --- Restore --------------------------------------------------------------------------

export interface RestorableWindow {
  id: string;
  appId: string;
  zIndex: number;
  isMinimized: boolean;
  minSize?: Size;
}

export interface PlanStep {
  appId: string;
  /** The open window to move, or null when the app has to be opened. */
  windowId: string | null;
  /** Already clamped to the current viewport. */
  geometry: WindowGeometry;
}

export interface RestorePlan {
  /** Bottom to top: apply in this order and the last one ends up in front. */
  steps: PlanStep[];
  /** Apps in the layout that cannot be opened any more (removed since it was saved). */
  skipped: string[];
  /** Visible windows the layout does not mention. */
  untouched: number;
}

export interface PlanInput {
  layout: readonly WorkspaceLayoutWindow[];
  windows: Readonly<Record<string, RestorableWindow>>;
  restorable: ReadonlySet<string>;
  /** null only before hydration; the rectangles are then used as saved (but never below the minimum). */
  viewport: Viewport | null;
  fit: FitConfig;
  /** The minimum size of a window that is not open yet. */
  minSize: Size;
}

/**
 * What restoring a layout does, decided without touching anything. An app that has a window
 * (its topmost one, even if minimised) is moved; one that has none is opened. Each rectangle
 * is raised to the window's minimum size and then fitted to the viewport as it is now, since
 * the screen may differ from the one the layout was saved on.
 */
export function planLayoutRestore(input: PlanInput): RestorePlan {
  const steps: PlanStep[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  const all = Object.values(input.windows);
  for (const entry of input.layout) {
    if (seen.has(entry.appId)) continue;
    seen.add(entry.appId);
    if (!input.restorable.has(entry.appId)) {
      skipped.push(entry.appId);
      continue;
    }
    if (steps.length >= MAX_LAYOUT_WINDOWS) break;
    let existing: RestorableWindow | undefined;
    for (const w of all) {
      if (w.appId === entry.appId && (!existing || w.zIndex > existing.zIndex)) {
        existing = w;
      }
    }
    const min = existing?.minSize ?? input.minSize;
    const wanted = {
      ...entry.rect,
      width: Math.max(min.width, entry.rect.width),
      height: Math.max(min.height, entry.rect.height),
    };
    const rect = input.viewport
      ? fitRectToViewport(wanted, input.viewport, input.fit, min)
      : wanted;
    steps.push({
      appId: entry.appId,
      windowId: existing?.id ?? null,
      geometry: {
        position: { x: rect.x, y: rect.y },
        size: { width: rect.width, height: rect.height },
      },
    });
  }
  const placed = new Set(steps.map((s) => s.windowId));
  const untouched = all.filter((w) => !w.isMinimized && !placed.has(w.id)).length;
  return { steps, skipped, untouched };
}

// --- Words ----------------------------------------------------------------------------

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One short line for what a restore did. */
export function describeRestore(done: {
  opened: number;
  moved: number;
  skipped: number;
  untouched: number;
  minimized: boolean;
}): string {
  const parts: string[] = [];
  if (done.opened) parts.push(`opened ${plural(done.opened, "app", "apps")}`);
  if (done.moved) parts.push(`moved ${plural(done.moved, "window", "windows")}`);
  let text = parts.length ? parts.join(", ") : "nothing to open";
  text = text.charAt(0).toUpperCase() + text.slice(1) + ".";
  if (done.skipped) {
    text += ` ${plural(done.skipped, "app is", "apps are")} no longer available.`;
  }
  if (done.untouched) {
    const others = plural(done.untouched, "other window", "other windows");
    text += done.minimized ? ` ${others} minimised.` : ` ${others} left open.`;
  }
  return text;
}
