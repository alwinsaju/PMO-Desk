// What the command bar offers as you focus or type: pinned favourites, chips that fit the app
// you are looking at (120), and completions from your history (119). Pure.

/** Chips for the focused app (its window's appId). */
export const CONTEXT_SUGGESTIONS: Readonly<Record<string, readonly string[]>> = {
  "pmo-todo": [
    "What's overdue?",
    "What do I need to chase?",
    "What changed since yesterday?",
  ],
  staff: ["Who's off this week?", "Who's off next Monday?"],
  tasks: ["Did the backlog report run this week?", "Prepare this week's aging report"],
  dashboard: ["PMO status", "What changed since yesterday?"],
  templates: ["Open PMO To-Do"],
};

export const DEFAULT_SUGGESTIONS: readonly string[] = [
  "Open Dashboard",
  "Who's off this week?",
  "What's overdue?",
  "Open Notes",
  "Open Files",
  "Open Tasks",
];

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** At most this many recent prompts appear as chips, so the starters still have room. */
export const MAX_RECENT_CHIPS = 3;

export interface Suggestion {
  text: string;
  /** Pinned by the person. */
  favourite: boolean;
  /** One of the person's own recent prompts. */
  recent: boolean;
}

/** Favourites first, then recent prompts (at most `MAX_RECENT_CHIPS`), then the focused
 *  app's chips, then the defaults; no repeats; at most `limit`. `recent` is expected
 *  newest first and already limited to prompts that worked (see recentSuccessfulPrompts). */
export function suggestionsFor(
  appId: string | null,
  favourites: readonly string[],
  limit = 6,
  recent: readonly string[] = [],
): Suggestion[] {
  const out: Suggestion[] = [];
  const add = (text: string, favourite: boolean, isRecent = false) => {
    if (out.length >= limit || out.some((s) => same(s.text, text))) return false;
    out.push({ text, favourite, recent: isRecent });
    return true;
  };
  for (const f of favourites) add(f, true);
  let recents = 0;
  for (const r of recent) {
    if (recents >= MAX_RECENT_CHIPS) break;
    if (add(r, false, true)) recents += 1;
  }
  for (const s of (appId && CONTEXT_SUGGESTIONS[appId]) || []) add(s, false);
  for (const s of DEFAULT_SUGGESTIONS) add(s, false);
  return out;
}

/** Completions for what has been typed: from your history and the suggestions, prefix matches first. */
export function completeFrom(
  typed: string,
  pool: readonly string[],
  limit = 4,
): string[] {
  const q = typed.trim().toLowerCase();
  if (q.length < 2) return [];
  const seen = new Set<string>();
  const starts: string[] = [];
  const contains: string[] = [];
  for (const candidate of pool) {
    const c = candidate.toLowerCase();
    if (c === q || seen.has(c)) continue;
    seen.add(c);
    if (c.startsWith(q)) starts.push(candidate);
    else if (c.includes(q)) contains.push(candidate);
  }
  return [...starts, ...contains].slice(0, limit);
}
