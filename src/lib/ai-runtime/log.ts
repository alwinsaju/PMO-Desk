// The local AI runtime's SESSION LOG (see ARCHITECTURE.md, "Local AI runtime",
// "Model log"): an in-memory ring buffer of structured events that the model
// log dialog reads. Pure (no node: imports) so `pnpm test` can load it.
//
// Privacy rules, enforced here and by a source-scan test:
//   - events carry kinds, counts, durations and a SHORT caller-supplied label
//     (e.g. a message subject, cut to LABEL_MAX). Never a prompt, a model
//     reply or a message body.
//   - the buffer lives in memory only and is dropped when the Next server
//     restarts. Nothing here writes to disk.

export type AiLogLevel = "info" | "warn" | "error";

export const LEVEL_RANK: Record<AiLogLevel, number> = { info: 0, warn: 1, error: 2 };

/** What a call is for. Free text on purpose (new call sites need no change here);
 *  these are the ones logView.ts knows how to word. */
export type AiTaskKind = string;

export const LABEL_MAX = 60;
const NOTE_MAX = 80;
const MESSAGE_MAX = 200;

/** One line, no control characters, cut to `max` with an ellipsis. */
export function cleanText(raw: unknown, max: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The optional `log` option every generate call can carry. */
export interface AiCallLogOptions<R = unknown> {
  /** Task kind, e.g. "structure". */
  task: AiTaskKind;
  /** SHORT human label for the local session log only (a message subject,
   *  a to-do title). Cut to LABEL_MAX. Never persisted to disk. */
  label?: string;
  /** Optional one-phrase summary of the RESULT, counts only ("3 action items
   *  found"). Never the result's text. */
  note?: (result: R) => string | undefined | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type AiLogBody =
  | {
      kind: "server-up";
      how: "started" | "reused" | "adopted";
      owned: boolean;
      baseUrl: string;
      version?: string;
      pid?: number;
    }
  | { kind: "server-down"; message: string; willRetry: boolean }
  | { kind: "server-stop"; owned: boolean; stopped: boolean }
  | { kind: "prewarm-skipped"; reason: "disabled" }
  | {
      kind: "model-loaded";
      model: string;
      ours: boolean;
      sizeBytes: number;
      expiresAt?: string;
      /** Why it is in memory: a call woke it, "Load now", it was already there
       *  when we first looked, or something else loaded it. */
      cause: "call" | "manual" | "already" | "other";
    }
  | {
      kind: "model-unloaded";
      model: string;
      ours: boolean;
      /** Last size seen in /api/ps: roughly the memory that was freed. */
      sizeBytes: number;
      reason: "idle" | "manual" | "shutdown" | "other";
      /** For "idle": the keep-alive that ran out. */
      idleMs?: number;
    }
  | { kind: "unload-request"; model: string; by: "user" | "shutdown"; keepAlive: 0 }
  | {
      kind: "call-queued";
      call: string;
      task: AiTaskKind;
      label?: string;
      /** Calls ahead of this one (the running one counts). */
      position: number;
      /** Calls waiting in the queue, including this one. */
      waiting: number;
    }
  | {
      kind: "call-start";
      call: string;
      task: AiTaskKind;
      label?: string;
      model: string;
      /** keep_alive sent with the request. */
      keepAlive: string;
      think?: boolean;
      /** Was the model in memory when the call started? null = unknown. */
      modelLoaded: boolean | null;
      /** Calls still waiting behind this one. */
      queueWaiting: number;
    }
  | {
      kind: "call-retry";
      call: string;
      /** The attempt that is about to start (2 = the repair round-trip). */
      attempt: number;
      reason: "invalid-json" | "invalid-schema" | "cut-off";
    }
  | {
      kind: "call-end";
      call: string;
      task: AiTaskKind;
      label?: string;
      model: string;
      ok: boolean;
      durationMs: number;
      attempts: number;
      /** From Ollama's reply (prompt_eval_count / eval_count / load_duration). */
      promptTokens?: number;
      evalTokens?: number;
      tokensPerSecond?: number;
      loadMs?: number;
      /** Counts-only summary of the result, see AiCallLogOptions.note. */
      note?: string;
      errorCode?: string;
      message?: string;
    };

export type AiLogKind = AiLogBody["kind"];
export type AiLogEvent = AiLogBody & { seq: number; ts: number; level: AiLogLevel };

/** The default level of an event; callers rarely need to override it. */
export function levelFor(body: AiLogBody): AiLogLevel {
  switch (body.kind) {
    case "server-down":
      return "error";
    case "call-retry":
      return "warn";
    case "call-end":
      if (body.ok) return "info";
      return body.errorCode === "timeout" || body.errorCode === "invalid-output"
        ? "warn"
        : "error";
    default:
      return "info";
  }
}

// ---------------------------------------------------------------------------
// Ring buffer
// ---------------------------------------------------------------------------

export const DEFAULT_LOG_CAPACITY = 1000;

export interface ActiveCall {
  call: string;
  task: AiTaskKind;
  label?: string;
  startedAt: number;
  modelLoadedBefore: boolean | null;
}

/** What createOllamaClient needs from a log (a RingLog, or a stub in a test). */
export interface AiLogSink {
  emit(body: AiLogBody): unknown;
  nextCallId(): string;
}

export class RingLog implements AiLogSink {
  /** Random per Next-server run; a client that sees it change starts over. */
  readonly session: string;
  readonly startedAt: number;
  private events: AiLogEvent[] = [];
  private seq = 0;
  private calls = 0;
  private readonly active = new Map<string, ActiveCall>();
  /** The call that woke an unloaded model and is still waiting for the tracker to
   *  see it in memory; tells model-loaded whether a call or "Load now" caused it. */
  pendingWake: { ts: number; task: AiTaskKind } | null = null;
  /** When the last call finished; the idle clock the keep-alive counts from. */
  lastCallEndAt: number | null = null;
  /** Last server state announced, so "up"/"down" are logged once per change. */
  serverState: "up" | "down" | null = null;

  readonly capacity: number;
  private readonly now: () => number;

  // (No parameter properties: plain Node's type stripping rejects them.)
  constructor(capacity: number = DEFAULT_LOG_CAPACITY, now: () => number = Date.now) {
    this.capacity = capacity;
    this.now = now;
    this.startedAt = now();
    this.session = `${this.startedAt.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  /** Latest sequence number (0 = nothing logged yet). */
  get latestSeq(): number {
    return this.seq;
  }

  /** Sequence number of the oldest event still held (0 when empty). */
  get oldestSeq(): number {
    return this.events[0]?.seq ?? 0;
  }

  get size(): number {
    return this.events.length;
  }

  nextCallId(): string {
    return `c${++this.calls}`;
  }

  emit(body: AiLogBody, level?: AiLogLevel): AiLogEvent {
    const event = {
      ...sanitize(body),
      seq: ++this.seq,
      ts: this.now(),
      level: level ?? levelFor(body),
    } as AiLogEvent;
    this.events.push(event);
    if (this.events.length > this.capacity) {
      this.events.splice(0, this.events.length - this.capacity);
    }
    this.track(event);
    return event;
  }

  /** Server up/down, announced only when it changes. null = unchanged. */
  emitServer(
    body: Extract<AiLogBody, { kind: "server-up" | "server-down" }>,
  ): AiLogEvent | null {
    const next = body.kind === "server-up" ? "up" : "down";
    if (this.serverState === next) return null;
    this.serverState = next;
    return this.emit(body);
  }

  /** Events with seq greater than `since`, oldest first. */
  since(since: number): AiLogEvent[] {
    if (!(since > 0)) return [...this.events];
    // The buffer is ordered by seq: find the first newer one.
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.events[mid].seq > since) hi = mid;
      else lo = mid + 1;
    }
    return this.events.slice(lo);
  }

  all(): AiLogEvent[] {
    return [...this.events];
  }

  activeCalls(): ActiveCall[] {
    return [...this.active.values()];
  }

  private track(event: AiLogEvent): void {
    if (event.kind === "call-start") {
      this.active.set(event.call, {
        call: event.call,
        task: event.task,
        label: event.label,
        startedAt: event.ts,
        modelLoadedBefore: event.modelLoaded,
      });
      if (event.modelLoaded === false)
        this.pendingWake = { ts: event.ts, task: event.task };
    } else if (event.kind === "call-end") {
      this.active.delete(event.call);
      this.lastCallEndAt = event.ts;
    } else if (event.kind === "server-stop") {
      this.serverState = null;
      this.pendingWake = null;
    }
  }
}

/** Free text is cut and flattened here as well as at the call sites, so no
 *  caller can put a paragraph in the log by mistake. */
function sanitize<T extends AiLogBody>(body: T): T {
  const out: Record<string, unknown> = { ...body };
  if ("label" in out) out.label = cleanText(out.label, LABEL_MAX);
  if ("note" in out) out.note = cleanText(out.note, NOTE_MAX);
  if ("message" in out) out.message = cleanText(out.message, MESSAGE_MAX);
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key];
  return out as T;
}
