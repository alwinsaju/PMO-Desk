// The shape of the saved UI preferences (the server-backed "preferences" store) and the
// one place that decides what a stored value is allowed to be. Anything stored by an older
// or hand-edited file falls back to a default per field instead of breaking the app.

export type DashboardPeriod = "this-week" | "next-week";

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Actions the command bar can ask about before it does them. */
export const CONFIRM_KEYS = ["create_todo", "todo_done", "todo_snooze"] as const;
export type ConfirmKey = (typeof CONFIRM_KEYS)[number];

/** One thing asked of the command bar: what was typed, which tool answered, how it ended. */
export interface CommandLogEntry {
  /** Epoch ms. */
  at: number;
  prompt: string;
  /** "whos_off", "todo_action:done", "model", ... */
  tool: string;
  outcome: "answered" | "done" | "cancelled" | "failed";
  /** What data it touched, in a few words ("to-do: Release plan"). */
  detail: string;
}

export interface Preferences {
  /** The Dashboard "Who's out" toggle. */
  dashboardPeriod: DashboardPeriod;
  /** Skip the lock screen's short pause and its "Continue" delay. */
  instantUnlock: boolean;
  /** Last position and size of each app's window, by app id. */
  windowRects: Record<string, WindowRect>;
  /** Which command-bar actions ask "are you sure?" first. */
  confirmActions: Record<ConfirmKey, boolean>;
  /** Settings > Accessibility: no animation or easing anywhere. */
  reducedMotion: boolean;
  /** Settings > Accessibility: stronger text, borders and focus ring. */
  highContrast: boolean;
  /** A small "Who's out today" card on the desktop. */
  desktopWidget: boolean;
  /** Closing a repeating to-do creates the next one by itself (with an Undo). */
  autoRecur: boolean;
  /** Saved To-Do list views. */
  savedViews: SavedView[];
  /** The latest commands, oldest first (history, recall and the audit view). */
  commandLog: CommandLogEntry[];
  /** Prompts pinned as quick commands. */
  favourites: string[];
}

export const DEFAULT_CONFIRM_ACTIONS: Record<ConfirmKey, boolean> = {
  create_todo: true,
  todo_done: true,
  todo_snooze: false,
};

export const DEFAULT_PREFERENCES: Preferences = {
  dashboardPeriod: "this-week",
  instantUnlock: false,
  windowRects: {},
  confirmActions: DEFAULT_CONFIRM_ACTIONS,
  reducedMotion: false,
  highContrast: false,
  desktopWidget: false,
  autoRecur: true,
  savedViews: [],
  commandLog: [],
  favourites: [],
};

export const MAX_COMMAND_LOG = 100;
export const MAX_FAVOURITES = 12;
const MAX_PROMPT = 300;
const MAX_DETAIL = 200;

/** Enough for every app and a lot of web-app windows, while a damaged file cannot grow without end. */
export const MAX_REMEMBERED_WINDOWS = 64;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCoordinate = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 100_000;

const isLength = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 && value < 100_000;

export function sanitizeWindowRect(value: unknown): WindowRect | null {
  if (!isObject(value)) return null;
  const { x, y, width, height } = value;
  if (!isCoordinate(x) || !isCoordinate(y) || !isLength(width) || !isLength(height)) {
    return null;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function sanitizeWindowRects(value: unknown): Record<string, WindowRect> {
  if (!isObject(value)) return {};
  const out: Record<string, WindowRect> = {};
  for (const [id, rect] of Object.entries(value)) {
    if (Object.keys(out).length >= MAX_REMEMBERED_WINDOWS) break;
    const clean = sanitizeWindowRect(rect);
    if (clean && id) out[id] = clean;
  }
  return out;
}

/** Record one window's rectangle. Same object back when nothing changes; the oldest entry goes when full. */
export function rememberWindowRect(
  rects: Record<string, WindowRect>,
  appId: string,
  rect: WindowRect,
): Record<string, WindowRect> {
  const clean = sanitizeWindowRect(rect);
  if (!clean || !appId) return rects;
  const old = rects[appId];
  if (
    old &&
    old.x === clean.x &&
    old.y === clean.y &&
    old.width === clean.width &&
    old.height === clean.height
  ) {
    return rects;
  }
  // Re-insert so the most recently moved window is last and the least recent goes first.
  const { [appId]: _replaced, ...others } = rects;
  const next = { ...others, [appId]: clean };
  const ids = Object.keys(next);
  if (ids.length > MAX_REMEMBERED_WINDOWS) {
    const oldest = ids.find((id) => id !== appId)!;
    delete next[oldest];
  }
  return next;
}

function sanitizeConfirm(value: unknown): Record<ConfirmKey, boolean> {
  const raw = isObject(value) ? value : {};
  const out = { ...DEFAULT_CONFIRM_ACTIONS };
  for (const key of CONFIRM_KEYS) {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  }
  return out;
}

const OUTCOMES = ["answered", "done", "cancelled", "failed"] as const;

export function sanitizeLogEntry(value: unknown): CommandLogEntry | null {
  if (!isObject(value)) return null;
  const { at, prompt, tool, outcome, detail } = value;
  const known = OUTCOMES.find((o) => o === outcome);
  if (
    typeof at !== "number" ||
    !Number.isFinite(at) ||
    typeof prompt !== "string" ||
    !prompt.trim() ||
    typeof tool !== "string" ||
    !known
  ) {
    return null;
  }
  return {
    at,
    prompt: prompt.trim().slice(0, MAX_PROMPT),
    tool: tool.slice(0, 60),
    outcome: known,
    detail: typeof detail === "string" ? detail.slice(0, MAX_DETAIL) : "",
  };
}

/** Append one command, keeping the newest `MAX_COMMAND_LOG`. */
export function appendCommandLog(
  log: readonly CommandLogEntry[],
  entry: CommandLogEntry,
): CommandLogEntry[] {
  const clean = sanitizeLogEntry(entry);
  return clean ? [...log, clean].slice(-MAX_COMMAND_LOG) : [...log];
}

/** Distinct prompts, newest first (up-arrow recall and suggestions). */
export function recentPrompts(log: readonly CommandLogEntry[], limit = 20): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = log.length - 1; i >= 0 && out.length < limit; i--) {
    const key = log[i].prompt.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(log[i].prompt);
    }
  }
  return out;
}

export function toggleFavourite(favourites: readonly string[], prompt: string): string[] {
  const text = prompt.trim().slice(0, MAX_PROMPT);
  if (!text) return [...favourites];
  const has = favourites.some((f) => f.toLowerCase() === text.toLowerCase());
  return has
    ? favourites.filter((f) => f.toLowerCase() !== text.toLowerCase())
    : [...favourites, text].slice(-MAX_FAVOURITES);
}

function sanitizeFavourites(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim() && out.length < MAX_FAVOURITES) {
      out.push(item.trim().slice(0, MAX_PROMPT));
    }
  }
  return out;
}

export const MAX_SAVED_VIEWS = 12;

/** A named combination of the To-Do list's filter, sort, tag and search text. */
export interface SavedView {
  id: string;
  name: string;
  filter: string;
  sort: string;
  tag: string | null;
  text: string;
}

export function sanitizeSavedView(value: unknown): SavedView | null {
  if (!isObject(value)) return null;
  const { id, name, filter, sort, tag, text } = value;
  if (typeof id !== "string" || !id || typeof name !== "string" || !name.trim())
    return null;
  if (typeof filter !== "string" || typeof sort !== "string") return null;
  return {
    id: id.slice(0, 40),
    name: name.trim().slice(0, 40),
    filter: filter.slice(0, 20),
    sort: sort.slice(0, 20),
    tag: typeof tag === "string" && tag.trim() ? tag.trim().slice(0, 40) : null,
    text: typeof text === "string" ? text.slice(0, 100) : "",
  };
}

/** Save a view; one with the same name (any case) is replaced. The newest MAX_SAVED_VIEWS stay. */
export function saveView(views: readonly SavedView[], view: SavedView): SavedView[] {
  const clean = sanitizeSavedView(view);
  if (!clean) return [...views];
  const rest = views.filter((v) => v.name.toLowerCase() !== clean.name.toLowerCase());
  return [...rest, clean].slice(-MAX_SAVED_VIEWS);
}

export const removeView = (views: readonly SavedView[], id: string): SavedView[] =>
  views.filter((v) => v.id !== id);

/** Whatever was stored (or nothing) -> a complete, valid Preferences. */
export function sanitizePreferences(value: unknown): Preferences {
  const raw = isObject(value) ? value : {};
  return {
    dashboardPeriod:
      raw.dashboardPeriod === "next-week" || raw.dashboardPeriod === "this-week"
        ? raw.dashboardPeriod
        : DEFAULT_PREFERENCES.dashboardPeriod,
    instantUnlock:
      typeof raw.instantUnlock === "boolean"
        ? raw.instantUnlock
        : DEFAULT_PREFERENCES.instantUnlock,
    windowRects: sanitizeWindowRects(raw.windowRects),
    confirmActions: sanitizeConfirm(raw.confirmActions),
    reducedMotion: typeof raw.reducedMotion === "boolean" ? raw.reducedMotion : false,
    highContrast: typeof raw.highContrast === "boolean" ? raw.highContrast : false,
    desktopWidget: typeof raw.desktopWidget === "boolean" ? raw.desktopWidget : false,
    autoRecur: typeof raw.autoRecur === "boolean" ? raw.autoRecur : true,
    savedViews: Array.isArray(raw.savedViews)
      ? raw.savedViews
          .map(sanitizeSavedView)
          .filter((v): v is SavedView => v !== null)
          .slice(-MAX_SAVED_VIEWS)
      : [],
    commandLog: Array.isArray(raw.commandLog)
      ? raw.commandLog
          .map(sanitizeLogEntry)
          .filter((e): e is CommandLogEntry => e !== null)
          .slice(-MAX_COMMAND_LOG)
      : [],
    favourites: sanitizeFavourites(raw.favourites),
  };
}
