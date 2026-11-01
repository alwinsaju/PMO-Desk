// What Ctrl+K knows about its slow sources (to-dos, templates, PMO tool records): which are
// still loading, which failed, and the items that have arrived. Pure; no fetching here.
import type { SearchItem } from "./searchIndex.ts";

export const SOURCE_IDS = ["todos", "templates", "records"] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export const SOURCE_LABEL: Record<SourceId, string> = {
  todos: "To-dos",
  templates: "Templates",
  records: "PMO tool records",
};

export type SourceStatus = "idle" | "loading" | "ready" | "failed";

export interface SourceState {
  status: SourceStatus;
  items: SearchItem[];
  /** When the items last arrived (ms), for the cache's freshness check. */
  loadedAt: number | null;
  /** Set when a ready source is only partly loaded (some PMO tools failed). */
  warning: string | null;
  error: string | null;
}

export type SourcesState = Record<SourceId, SourceState>;

export type LoadResult =
  { ok: true; items: SearchItem[]; warning?: string } | { ok: false; message: string };

export type SourcesAction =
  | { type: "start"; source: SourceId }
  | { type: "settled"; source: SourceId; result: LoadResult; at: number };

const emptySource = (): SourceState => ({
  status: "idle",
  items: [],
  loadedAt: null,
  warning: null,
  error: null,
});

export const initialSources = (): SourcesState => ({
  todos: emptySource(),
  templates: emptySource(),
  records: emptySource(),
});

function reduceSource(current: SourceState, action: SourcesAction): SourceState {
  if (action.type === "start") {
    // A source that already has data refreshes silently: no loading state, no flicker.
    if (current.status === "ready" || current.status === "loading") return current;
    return { ...current, status: "loading", error: null };
  }
  const { result, at } = action;
  if (result.ok) {
    return {
      status: "ready",
      items: result.items,
      loadedAt: at,
      warning: result.warning ?? null,
      error: null,
    };
  }
  // A failed refresh keeps the older items instead of blanking the source.
  if (current.loadedAt !== null) return current;
  return { ...emptySource(), status: "failed", error: result.message };
}

export function sourcesReducer(state: SourcesState, action: SourcesAction): SourcesState {
  const next = reduceSource(state[action.source], action);
  return next === state[action.source] ? state : { ...state, [action.source]: next };
}

/** Sources whose first answer has not come yet. */
export const pendingSources = (state: SourcesState): SourceId[] =>
  SOURCE_IDS.filter(
    (id) => state[id].status === "idle" || state[id].status === "loading",
  );

export const loadedItems = (state: SourcesState): SearchItem[] =>
  SOURCE_IDS.flatMap((id) => state[id].items);

/** One plain sentence per source that failed or only partly loaded. */
export function sourceProblems(state: SourcesState): string[] {
  return SOURCE_IDS.flatMap((id) => {
    const source = state[id];
    if (source.status === "failed") {
      return [
        `${SOURCE_LABEL[id]} could not be loaded${source.error ? `: ${source.error}` : ""}`,
      ];
    }
    return source.warning ? [source.warning] : [];
  });
}

const PENDING_WORDS: Record<SourceId, string> = {
  todos: "to-dos",
  templates: "templates",
  records: "records",
};

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export type EmptyState = { kind: "searching" | "none"; text: string };

/** What to say when nothing matches: still searching, or really nothing. */
export function emptyStateFor(state: SourcesState, query: string): EmptyState {
  const pending = pendingSources(state);
  if (pending.length > 0) {
    return {
      kind: "searching",
      text: `Searching ${joinWords(pending.map((id) => PENDING_WORDS[id]))}…`,
    };
  }
  return { kind: "none", text: `Nothing matches “${query.trim()}”.` };
}

/** Folds the per-tool register loads into one result; one broken tool never hides the rest. */
export function combineRecordLoads(
  tools: readonly { title: string; result: LoadResult }[],
): LoadResult {
  const failed = tools.filter((t) => !t.result.ok);
  if (tools.length > 0 && failed.length === tools.length) {
    const first = failed[0]?.result;
    return { ok: false, message: first && !first.ok ? first.message : "No answer" };
  }
  const items = tools.flatMap((t) => (t.result.ok ? t.result.items : []));
  if (failed.length === 0) return { ok: true, items };
  const names = failed.map((t) => t.title).join(", ");
  return {
    ok: true,
    items,
    warning: `Some PMO tool records could not be loaded (${names})`,
  };
}
