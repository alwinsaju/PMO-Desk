// Pure resolution of "open/focus an app" requests for the AI command bar.
// No React, no stores — CommandBar.tsx and the command route both use it.

export const AI_APP_IDS = ["files", "notes", "browser", "tasks", "app-store"] as const;
export type AiAppId = (typeof AI_APP_IDS)[number];

export interface WindowRef {
  id: string;
  appId: string;
  title?: string;
  zIndex?: number;
}

const APP_ALIASES: Record<AiAppId, readonly string[]> = {
  files: ["files", "file", "file explorer", "my files"],
  notes: ["notes", "note", "notepad"],
  browser: ["browser", "web browser", "web", "internet"],
  tasks: ["tasks", "task", "task list", "tasks app"],
  "app-store": ["app store", "app-store", "appstore", "store", "apps"],
};

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function appIdFromName(name: string): AiAppId | null {
  const key = normalize(name);
  for (const appId of AI_APP_IDS) {
    if (APP_ALIASES[appId].includes(key)) return appId;
  }
  return null;
}

const OPEN_PHRASE =
  /^(?:please\s+)?(?:open|launch|start|show|go to|switch to)\s+(?:up\s+)?(?:the\s+|my\s+)?(.+?)(?:\s+(?:app|window))?\s*[.!]?$/i;

/** "Open Notes" / "launch the files app" -> the app id; anything else
 *  (a real question or a compound request) -> null, left to the model. */
export function resolveOpenIntent(prompt: string): AiAppId | null {
  const match = OPEN_PHRASE.exec(prompt.trim());
  return match ? appIdFromName(match[1]) : null;
}

function topmost(windows: WindowRef[]): WindowRef | undefined {
  return windows.reduce<WindowRef | undefined>(
    (best, w) => (!best || (w.zIndex ?? 0) >= (best.zIndex ?? 0) ? w : best),
    undefined,
  );
}

export type OpenPlan = { type: "focus"; windowId: string } | { type: "open" };

/** Opening an app that already has a window raises it; otherwise open one. */
export function planOpenApp(appId: string, windows: WindowRef[]): OpenPlan {
  const existing = topmost(windows.filter((w) => w.appId === appId));
  return existing ? { type: "focus", windowId: existing.id } : { type: "open" };
}

export type WindowTarget =
  { kind: "window"; id: string } | { kind: "open-app"; appId: AiAppId };

/** Resolves what a model-supplied window reference means: an exact window
 *  id, or (models often pass the app name) an app — whose open window is
 *  used, or which must be opened when it isn't running. */
export function resolveWindowTarget(
  ref: string,
  windows: WindowRef[],
): WindowTarget | null {
  if (windows.some((w) => w.id === ref)) return { kind: "window", id: ref };
  const key = normalize(ref);
  const byTitle = windows.find((w) => w.title && normalize(w.title) === key);
  if (byTitle) return { kind: "window", id: byTitle.id };
  const appId = appIdFromName(ref);
  if (!appId) return null;
  const plan = planOpenApp(appId, windows);
  return plan.type === "focus"
    ? { kind: "window", id: plan.windowId }
    : { kind: "open-app", appId };
}
