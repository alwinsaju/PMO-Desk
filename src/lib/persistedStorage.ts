// A zustand `StateStorage` that keeps a store on the server (/api/ui-state/<key>)
// so it survives a change of port (localStorage is per origin, port included),
// with localStorage as the immediate copy and the fallback when the server
// can't be reached. Never throws: a store must keep working without either.
import type { StateStorage } from "zustand/middleware";

export const SERVER_WRITE_DEBOUNCE_MS = 300;

type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    keepalive?: boolean;
  },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

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
  let pending: string | null = null;

  const readLocal = (name: string): string | null =>
    resolved.localStorage ? safe(() => resolved.localStorage!.getItem(name)) : null;

  // Server unavailable is fine: localStorage already has the data.
  const call = async (init: Parameters<FetchLike>[1]): Promise<void> => {
    try {
      await resolved.fetch(url, init);
    } catch {
      // Ignored on purpose.
    }
  };

  const putToServer = async (text: string, keepalive = false): Promise<void> => {
    const value = parseStoredValue(text);
    if (!value) return;
    await call({
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({ value }),
      ...(keepalive ? { keepalive: true } : {}),
    });
  };

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending === null) return;
    const text = pending;
    pending = null;
    const value = parseStoredValue(text);
    if (!value) return;
    // POST because sendBeacon cannot do PUT; the route accepts both.
    if (safe(() => resolved.sendBeacon(url, JSON.stringify({ value })))) return;
    void putToServer(text, true);
  };

  resolved.onPageHide(flush);

  const load = async (name: string): Promise<string | null> => {
    const local = readLocal(name);
    try {
      const response = await resolved.fetch(url);
      if (!response.ok) return local;
      const body = (await response.json()) as { ok?: unknown; value?: unknown };
      if (body?.ok !== true) return local;
      if (body.value !== null && typeof body.value === "object") {
        return JSON.stringify(body.value);
      }
      // The server has nothing: hand this browser's copy over, once.
      if (local !== null) void putToServer(local);
      return local;
    } catch {
      return local;
    }
  };

  return {
    getItem: (name) => {
      if (cached !== undefined) return cached;
      firstRead ??= load(name).then((value) => {
        // A write that landed while the read was in flight is newer.
        if (cached === undefined) cached = value;
        return cached;
      });
      return firstRead;
    },

    setItem: (name, value) => {
      cached = value;
      if (resolved.localStorage) safe(() => resolved.localStorage!.setItem(name, value));
      pending = value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const text = pending;
        pending = null;
        if (text !== null) void putToServer(text);
      }, SERVER_WRITE_DEBOUNCE_MS);
    },

    removeItem: (name) => {
      cached = null;
      pending = null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (resolved.localStorage) safe(() => resolved.localStorage!.removeItem(name));
      void call({ method: "DELETE" });
    },
  };
}
