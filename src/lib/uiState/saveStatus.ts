// What the last attempt to store a UI state key on the server came to, so a
// screen can say "Saved" only when it is true. Pure module state, no React.

export type SaveFailure = "too-large" | "rejected" | "unreachable";

export type SaveStatus =
  | { state: "saved" }
  | { state: "saving" }
  | { state: "error"; failure: SaveFailure; willRetry: boolean };

const SAVED: SaveStatus = { state: "saved" };

const statuses = new Map<string, SaveStatus>();
const listeners = new Map<string, Set<() => void>>();

function same(a: SaveStatus, b: SaveStatus): boolean {
  if (a.state !== b.state) return false;
  if (a.state !== "error" || b.state !== "error") return true;
  return a.failure === b.failure && a.willRetry === b.willRetry;
}

export function getSaveStatus(key: string): SaveStatus {
  return statuses.get(key) ?? SAVED;
}

/** Only notifies when something changed, so typing does not re-render on every key. */
export function setSaveStatus(key: string, next: SaveStatus): void {
  if (same(getSaveStatus(key), next)) return;
  statuses.set(key, next);
  for (const listener of listeners.get(key) ?? []) listener();
}

export function subscribeSaveStatus(key: string, listener: () => void): () => void {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(listener);
  return () => void set.delete(listener);
}

/** HTTP status of a refused save -> what to tell the user. */
export function failureFromStatus(status: number | undefined): SaveFailure {
  if (status === 413) return "too-large";
  if (status !== undefined && status >= 400 && status < 500) return "rejected";
  return "unreachable";
}

/** Waiting does not help for a too-large or refused save; the next edit tries again. */
export function isRetryable(failure: SaveFailure): boolean {
  return failure === "unreachable";
}

const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000] as const;

/** Back-off between automatic retries (0-based attempt count), capped at one minute. */
export function retryDelayMs(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(Math.max(attempt, 0), RETRY_DELAYS_MS.length - 1)];
}

export type RestoreSource = "local" | "server";

export interface RestoreInput {
  hasLocal: boolean;
  hasServer: boolean;
  /** This browser's copy has changes the server never confirmed. */
  localUnsynced: boolean;
  /** When (ms since epoch) the unconfirmed local copy was last changed. */
  localChangedAt: number | null;
  /** When (ms since epoch) the server's copy was last written; null if unknown. */
  serverChangedAt: number | null;
}

/** Which copy to start from: the server's, unless this browser holds a newer
 *  edit the server never confirmed (a failed or interrupted save). */
export function chooseRestoreSource(input: RestoreInput): RestoreSource {
  if (!input.hasServer) return "local";
  if (!input.hasLocal) return "server";
  if (!input.localUnsynced) return "server";
  if (input.serverChangedAt === null || input.localChangedAt === null) return "local";
  return input.localChangedAt >= input.serverChangedAt ? "local" : "server";
}

export interface SyncMeta {
  dirty: boolean;
  at: number;
}

export function parseSyncMeta(text: string | null): SyncMeta | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Partial<SyncMeta> | null;
    if (value && typeof value.dirty === "boolean" && Number.isFinite(value.at)) {
      return { dirty: value.dirty, at: value.at as number };
    }
  } catch {
    // Treated as no metadata.
  }
  return null;
}
