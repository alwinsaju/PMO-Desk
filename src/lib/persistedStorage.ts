// A zustand `StateStorage` that keeps a store on the server (/api/ui-state/<key>)
// so it survives a change of port (localStorage is per origin, port included),
// with localStorage as the immediate copy and the fallback when the server
// can't be reached. Never throws: a store must keep working without either.
//
// A save the server refuses or never receives is reported through
// `uiState/saveStatus` and retried; the browser's copy is flagged as unconfirmed
// so the next start prefers it over an older server copy.
import type { StateStorage } from "zustand/middleware";
import {
  chooseRestoreSource,
  failureFromStatus,
  isRetryable,
  parseSyncMeta,
  retryDelayMs,
  setSaveStatus,
  type SaveFailure,
} from "./uiState/saveStatus.ts";

export const SERVER_WRITE_DEBOUNCE_MS = 300;

type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    keepalive?: boolean;
  },
) => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface ServerBackedDeps {
  fetch?: FetchLike;
  /** null = no local storage at all. */
  localStorage?: StorageLike | null;
  /** Fire-and-forget delivery during page teardown; true if queued. */
  sendBeacon?: (url: string, body: string) => boolean;
  /** Subscribe to "the page is going away"; defaults to pagehide / tab hidden. */
  onPageHide?: (callback: () => void) => void;
}

function browserDeps(): Required<ServerBackedDeps> {
  const inBrowser = typeof window !== "undefined";
  let local: StorageLike | null = null;
  try {
    local = inBrowser ? window.localStorage : null;
  } catch {
    local = null;
  }
  return {
    // Outside a browser (SSR) there is no origin to call: behave as "no server".
    fetch: inBrowser
      ? (input, init) => globalThis.fetch(input, init)
      : () => Promise.reject(new Error("no server")),
    localStorage: local,
    sendBeacon: (url, body) =>
      typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function"
        ? navigator.sendBeacon(url, new Blob([body], { type: "application/json" }))
        : false,
    onPageHide: (callback) => {
      if (!inBrowser) return;
      window.addEventListener("pagehide", callback);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") callback();
      });
    },
  };
}

function safe<T>(run: () => T): T | null {
  try {
    return run();
  } catch {
    return null;
  }
}

/** The server only holds objects/arrays; anything else is not sent. */
function parseStoredValue(text: string): object | null {
  const value = safe(() => JSON.parse(text) as unknown);
  return value !== null && typeof value === "object" ? value : null;
}

/** `key` is the server key; zustand's own `name` is still the localStorage key. */
export function createServerBackedStorage(
  key: string,
  deps: ServerBackedDeps = {},
): StateStorage {
  const resolved = { ...browserDeps(), ...deps };
  const url = `/api/ui-state/${encodeURIComponent(key)}`;
  const jsonHeaders = { "Content-Type": "application/json" };

  // undefined = not read yet; afterwards always the latest known value.
  let cached: string | null | undefined;
  let firstRead: Promise<string | null> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAttempt = 0;
  // The newest text the server has not confirmed yet.
  let pending: string | null = null;
  let writeSeq = 0;
  let inFlight = false;
  let resendAfterFlight = false;
  let storageName: string | null = null;

  const readLocal = (name: string): string | null =>
    resolved.localStorage ? safe(() => resolved.localStorage!.getItem(name)) : null;

  const metaKey = (name: string) => `${name}.sync`;
  const writeMeta = (dirty: boolean, at = Date.now()): void => {
    if (!resolved.localStorage || storageName === null) return;
    safe(() =>
      resolved.localStorage!.setItem(
        metaKey(storageName!),
        JSON.stringify({ dirty, at }),
      ),
    );
  };

  const clearRetry = (): void => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  type PutResult = { ok: true } | { ok: false; failure: SaveFailure };

  const putToServer = async (text: string, keepalive = false): Promise<PutResult> => {
    const value = parseStoredValue(text);
    if (!value) return { ok: true };
    try {
      const response = await resolved.fetch(url, {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ value }),
        ...(keepalive ? { keepalive: true } : {}),
      });
      if (response.ok) return { ok: true };
      return { ok: false, failure: failureFromStatus(response.status) };
    } catch {
      return { ok: false, failure: "unreachable" };
    }
  };

  const call = async (init: Parameters<FetchLike>[1]): Promise<void> => {
    try {
      await resolved.fetch(url, init);
    } catch {
      // Ignored on purpose.
    }
  };

  const send = async (keepalive = false): Promise<void> => {
    if (inFlight) {
      resendAfterFlight = true;
      return;
    }
    const text = pending;
    if (text === null) return;
    const seq = writeSeq;
    inFlight = true;
    setSaveStatus(key, { state: "saving" });
    const result = await putToServer(text, keepalive);
    inFlight = false;
    const superseded = seq !== writeSeq;
    if (result.ok) {
      retryAttempt = 0;
      if (!superseded) {
        pending = null;
        writeMeta(false);
        setSaveStatus(key, { state: "saved" });
      }
    } else if (!superseded) {
      const willRetry = isRetryable(result.failure);
      setSaveStatus(key, { state: "error", failure: result.failure, willRetry });
      if (willRetry) {
        clearRetry();
        retryTimer = setTimeout(() => {
          retryTimer = null;
          retryAttempt++;
          void send();
        }, retryDelayMs(retryAttempt));
        // Never keep a test runner or a closing process waiting for a retry.
        (retryTimer as { unref?: () => void }).unref?.();
      }
    }
    if (resendAfterFlight) {
      resendAfterFlight = false;
      if (pending !== null && !timer) void send();
    }
  };

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    clearRetry();
    if (pending === null) return;
    const text = pending;
    const value = parseStoredValue(text);
    if (!value) return;
    // POST because sendBeacon cannot do PUT; the route accepts both. A beacon
    // cannot report back, so the local copy stays flagged as unconfirmed.
    if (safe(() => resolved.sendBeacon(url, JSON.stringify({ value })))) {
      pending = null;
      return;
    }
    void send(true);
  };

  resolved.onPageHide(flush);

  const load = async (name: string): Promise<string | null> => {
    storageName = name;
    const local = readLocal(name);
    const meta = resolved.localStorage
      ? parseSyncMeta(safe(() => resolved.localStorage!.getItem(metaKey(name))))
      : null;
    try {
      const response = await resolved.fetch(url);
      if (!response.ok) return local;
      const body = (await response.json()) as {
        ok?: unknown;
        value?: unknown;
        updatedAt?: unknown;
      };
      if (body?.ok !== true) return local;
      const hasServer = body.value !== null && typeof body.value === "object";
      const source = chooseRestoreSource({
        hasLocal: local !== null,
        hasServer,
        localUnsynced: meta?.dirty === true,
        localChangedAt: meta?.at ?? null,
        serverChangedAt: typeof body.updatedAt === "number" ? body.updatedAt : null,
      });
      if (source === "server") return JSON.stringify(body.value);
      // This browser's copy is the one to keep: hand it to the server, once.
      if (local !== null) {
        pending ??= local;
        void send();
      }
      return local;
    } catch {
      return local;
    }
  };

  return {
    getItem: (name) => {
      storageName = name;
      if (cached !== undefined) return cached;
      firstRead ??= load(name).then((value) => {
        // A write that landed while the read was in flight is newer.
        if (cached === undefined) cached = value;
        return cached;
      });
      return firstRead;
    },

    setItem: (name, value) => {
      storageName = name;
      cached = value;
      writeSeq++;
      if (resolved.localStorage) safe(() => resolved.localStorage!.setItem(name, value));
      writeMeta(true);
      pending = value;
      clearRetry();
      setSaveStatus(key, { state: "saving" });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void send();
      }, SERVER_WRITE_DEBOUNCE_MS);
    },

    removeItem: (name) => {
      storageName = name;
      cached = null;
      pending = null;
      writeSeq++;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      clearRetry();
      if (resolved.localStorage) {
        safe(() => resolved.localStorage!.removeItem(name));
        safe(() => resolved.localStorage!.removeItem(metaKey(name)));
      }
      setSaveStatus(key, { state: "saved" });
      void call({ method: "DELETE" });
    },
  };
}
