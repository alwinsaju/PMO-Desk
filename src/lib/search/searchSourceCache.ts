// Session cache for the slow Ctrl+K sources. Loads start early (app start), are shared by every
// caller, and refresh in the background when older than the caller's `maxAgeMs`. Pure apart from
// the injected loaders and clock.
import {
  initialSources,
  SOURCE_IDS,
  sourcesReducer,
  type LoadResult,
  type SourceId,
  type SourcesAction,
  type SourcesState,
} from "./searchSources.ts";

export type SourceLoaders = Record<SourceId, () => Promise<LoadResult>>;

export interface SourceCache {
  getState: () => SourcesState;
  subscribe: (listener: () => void) => () => void;
  /** Loads what is missing or older than `maxAgeMs`; resolves when those loads settle. */
  ensure: (maxAgeMs: number) => Promise<void>;
}

export function createSourceCache(options: {
  loaders: SourceLoaders;
  now: () => number;
  /** Turns a thrown error into a short plain reason. */
  describeError?: (error: unknown) => string;
}): SourceCache {
  const {
    loaders,
    now,
    describeError = (e) => (e instanceof Error ? e.message : String(e)),
  } = options;
  let state = initialSources();
  const listeners = new Set<() => void>();
  const inFlight = new Map<SourceId, Promise<void>>();

  const dispatch = (action: SourcesAction) => {
    const next = sourcesReducer(state, action);
    if (next === state) return;
    state = next;
    listeners.forEach((listener) => listener());
  };

  const load = (source: SourceId): Promise<void> => {
    const running = inFlight.get(source);
    if (running) return running;
    dispatch({ type: "start", source });
    const run = (async () => {
      let result: LoadResult;
      try {
        result = await loaders[source]();
      } catch (error) {
        result = { ok: false, message: describeError(error) };
      }
      dispatch({ type: "settled", source, result, at: now() });
    })().finally(() => inFlight.delete(source));
    inFlight.set(source, run);
    return run;
  };

  const isStale = (source: SourceId, maxAgeMs: number): boolean => {
    const { status, loadedAt } = state[source];
    if (status === "idle" || status === "failed") return true;
    return status === "ready" && (loadedAt === null || now() - loadedAt >= maxAgeMs);
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ensure: async (maxAgeMs) => {
      await Promise.all(SOURCE_IDS.filter((id) => isStale(id, maxAgeMs)).map(load));
    },
  };
}
