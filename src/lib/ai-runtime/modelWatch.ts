// Load/unload transition detector for the session log. Ollama never tells us
// when it frees a model (keep_alive just runs out), so the only way to log
// "the model went to sleep" is to compare /api/ps now with what it listed last
// time. This file is the pure comparison; index.ts decides WHEN to look (right
// after calls, on a modest timer only while a model is loaded, and whenever the
// log endpoint is polled) and never looks on a timer while the model is asleep.
import { normalizeModelName, type LoadedModel } from "./core.ts";
import { RingLog, type AiLogEvent } from "./log.ts";

/** Within this of the keep-alive deadline, a disappearance counts as "idle". */
const IDLE_SLACK_MS = 15_000;

interface Known {
  model: LoadedModel;
  expiresAtMs: number | null;
}

export interface ObserveOptions {
  now: number;
  defaultModel: string;
}

export class ModelTracker {
  private known = new Map<string, Known>();
  private primed = false;
  private expected = new Map<string, "manual" | "shutdown">();

  private readonly ring: RingLog;

  constructor(ring: RingLog) {
    this.ring = ring;
  }

  /** Is anything in memory as of the last observation? Drives the watch timer. */
  anyLoaded(): boolean {
    return this.known.size > 0;
  }

  /** The next time this model disappears, say why (we asked for it). */
  expectUnload(name: string, reason: "manual" | "shutdown"): void {
    this.expected.set(normalizeModelName(name), reason);
  }

  /** An unload we asked for did not happen: forget that we expected it. */
  clearExpected(name: string): void {
    this.expected.delete(normalizeModelName(name));
  }

  /** The server is gone or restarted: forget what was loaded without announcing
   *  an unload per model (the server-down / server-up lines say it). */
  reset(): void {
    this.known.clear();
    this.expected.clear();
    this.primed = false;
  }

  /** Compare /api/ps with the last observation and log what changed. */
  observe(models: LoadedModel[], options: ObserveOptions): AiLogEvent[] {
    const { now, defaultModel } = options;
    const ours = normalizeModelName(defaultModel);
    const out: AiLogEvent[] = [];
    const current = new Map(models.map((m) => [normalizeModelName(m.name), m]));

    for (const [name, model] of current) {
      const before = this.known.get(name);
      const expiresAtMs = parseExpiry(model.expiresAt);
      this.known.set(name, { model, expiresAtMs });
      if (before) continue;

      const isOurs = name === ours;
      let cause: "call" | "manual" | "already" | "other" = "other";
      if (isOurs && this.ring.pendingWake) {
        cause = this.ring.pendingWake.task === "load" ? "manual" : "call";
        this.ring.pendingWake = null;
      } else if (!this.primed) {
        cause = "already";
      }
      out.push(
        this.ring.emit({
          kind: "model-loaded",
          model: model.name,
          ours: isOurs,
          sizeBytes: model.sizeBytes,
          ...(model.expiresAt ? { expiresAt: model.expiresAt } : {}),
          cause,
        }),
      );
    }

    for (const [name, before] of [...this.known]) {
      if (current.has(name)) continue;
      this.known.delete(name);
      const asked = this.expected.get(name);
      this.expected.delete(name);
      let reason: "idle" | "manual" | "shutdown" | "other" = "other";
      let idleMs: number | undefined;
      if (asked) {
        reason = asked;
      } else if (
        before.expiresAtMs !== null &&
        now >= before.expiresAtMs - IDLE_SLACK_MS
      ) {
        reason = "idle";
        const lastEnd = this.ring.lastCallEndAt;
        if (lastEnd !== null && before.expiresAtMs > lastEnd) {
          idleMs = before.expiresAtMs - lastEnd;
        }
      }
      out.push(
        this.ring.emit({
          kind: "model-unloaded",
          model: before.model.name,
          ours: name === ours,
          sizeBytes: before.model.sizeBytes,
          reason,
          ...(idleMs ? { idleMs } : {}),
        }),
      );
    }

    this.primed = true;
    return out;
  }
}

function parseExpiry(raw: string | null): number | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

// ---------------------------------------------------------------------------
// The shared instance
// ---------------------------------------------------------------------------

export interface AiLogState {
  ring: RingLog;
  tracker: ModelTracker;
  /** The "look at /api/ps again" timer, armed only while a model is loaded. */
  watchTimer?: ReturnType<typeof setTimeout>;
  /** A "Load now" (or any warm-up) is running in the background. */
  loadInFlight: boolean;
  /** The start-up pre-warm decision was made (and logged) once already. */
  prewarmDecided: boolean;
}

declare global {
  var aiOsAiLog: AiLogState | undefined;
}

/** Next compiles instrumentation and every route into separate module graphs,
 *  so the log lives on globalThis like the queue and the server process do. */
export function getAiLogState(): AiLogState {
  if (!globalThis.aiOsAiLog) {
    const ring = new RingLog();
    globalThis.aiOsAiLog = {
      ring,
      tracker: new ModelTracker(ring),
      loadInFlight: false,
      prewarmDecided: false,
    };
  }
  return globalThis.aiOsAiLog;
}
