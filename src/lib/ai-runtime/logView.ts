// Pure presentation of the session log: the "Plain English" timeline, the "Raw"
// lines, their filters and the model-state words, all derived from the same
// structured events (log.ts) so the two views cannot disagree. No React, no
// node: imports, relative imports with the .ts extension, so `pnpm test` and the
// browser both load it (see logView.test.mjs).
import { LEVEL_RANK, type AiLogEvent, type AiLogLevel } from "./log.ts";
import { MEMORY_SIZE, formatBytes } from "../format.ts";
import type { AiRuntimeStatus } from "./types.ts";

// --- small formatters -------------------------------------------------------------

/** "850 ms", "3.2 s", "19 s", "1 min 12 s". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0 s";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total} s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m} min` : `${m} min ${s} s`;
}

/** "about 8 GB": whole GB, for sentences where a decimal would be noise. */
export function aboutBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return gb >= 1
    ? `about ${Math.round(gb)} GB`
    : `about ${formatBytes(bytes, MEMORY_SIZE)}`;
}

/** "19:31" in `timeZone` (the viewer's own by default). */
export function formatClock(ts: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(ts));
}

/** "2 min" / "45 s" for an idle period. */
function formatIdle(ms: number): string {
  if (ms < 90_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  return `${Math.round(ms / 60_000)} min`;
}

// --- the model's state, in words --------------------------------------------------

export type ModelState =
  "down" | "model-missing" | "loading" | "working" | "ready" | "asleep";

/** keep_alive far in the future means "stays loaded"; a countdown is no use. */
const MAX_COUNTDOWN_MS = 24 * 60 * 60 * 1000;

/** `expiresAt` as ISO if it is a real, near deadline, else null. */
export function usableExpiry(
  expiresAt: string | null | undefined,
  nowMs: number,
): string | null {
  if (!expiresAt) return null;
  const ms = Date.parse(expiresAt);
  if (!Number.isFinite(ms) || ms > nowMs + MAX_COUNTDOWN_MS) return null;
  return new Date(ms).toISOString();
}

/** "1:32" until the model unloads, null when there is no deadline (or it has passed). */
export function unloadCountdown(
  unloadsAt: string | null | undefined,
  nowMs: number,
): string | null {
  if (!unloadsAt) return null;
  const ms = Date.parse(unloadsAt) - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export interface ModelStateInfo {
  state: ModelState;
  /** Task kind being worked on (not the load/pre-load ones), when working. */
  task: string | null;
  /** When the loaded model will unload (ISO), when it is in memory. */
  unloadsAt: string | null;
  /** Memory the default model holds, 0 when asleep. */
  sizeBytes: number;
}

/** core.normalizeModelName, repeated: core.ts imports node:path, which the
 *  browser bundle must not pull in. */
const normalizeName = (name: string) => (name.includes(":") ? name : `${name}:latest`);

const LOAD_TASKS = new Set(["load", "prewarm"]);

/** One answer to "what is the model doing?" for the chip and the dialog. */
export function modelStateOf(status: AiRuntimeStatus, nowMs: number): ModelStateInfo {
  const wanted = normalizeName(status.defaultModel);
  const ours = status.loaded.find((m) => normalizeName(m.name) === wanted);
  const base = {
    task: null as string | null,
    unloadsAt: ours ? usableExpiry(ours.expiresAt, nowMs) : null,
    sizeBytes: ours?.sizeBytes ?? 0,
  };
  if (!status.running) return { ...base, state: "down", unloadsAt: null, sizeBytes: 0 };
  if (status.modelInstalled === false) {
    return { ...base, state: "model-missing", unloadsAt: null, sizeBytes: 0 };
  }
  const active = status.activeCalls;
  if (active.length > 0 || status.loadInFlight) {
    const loadingTask = status.loadInFlight || active.some((c) => LOAD_TASKS.has(c.task));
    const real = active.find((c) => !LOAD_TASKS.has(c.task));
    return {
      ...base,
      state: !status.modelLoaded || loadingTask ? "loading" : "working",
      task: real?.task ?? null,
    };
  }
  return { ...base, state: status.modelLoaded ? "ready" : "asleep" };
}

// --- wording of tasks -------------------------------------------------------------

const quoted = (label?: string) => (label ? ` "${label}"` : "");

const TASK_PHRASE: Record<string, (label?: string) => string> = {
  structure: (l) => `Reading a message${quoted(l)} to propose a to-do`,
  update: (l) => `Reading a reply${quoted(l)} to update a to-do`,
  "update-signoff": (l) => `Reading a reply${quoted(l)} to check for a sign-off`,
  chaser: (l) => `Drafting a chaser${l ? ` for "${l}"` : ""}`,
  "signoff-request": (l) => `Improving a sign-off request${l ? ` for "${l}"` : ""}`,
  report: (l) => `Writing the report highlights${l ? ` for ${l}` : ""}`,
  command: (l) => `Answering a command-bar request${l ? ` (${l})` : ""}`,
};

/** "Reading a message "Cutover checklist..." to propose a to-do". */
export function describeTask(task: string, label?: string): string {
  const phrase = TASK_PHRASE[task];
  return phrase ? phrase(label) : `Running a model request${quoted(label)}`;
}

/** What the chip says after "Working on": a short noun phrase. */
export function taskNoun(task: string | null | undefined): string {
  switch (task) {
    case "structure":
      return "a message";
    case "update":
      return "a reply";
    case "update-signoff":
      return "a sign-off reply";
    case "chaser":
      return "a chaser";
    case "signoff-request":
      return "a sign-off request";
    case "report":
      return "the report";
    case "command":
      return "a command";
    default:
      return "a request";
  }
}

const MESSAGE_TASKS = new Set(["structure", "update", "update-signoff"]);

const FAILURE_WHY: Record<string, string> = {
  timeout: "the model did not answer in time",
  "runtime-down": "Ollama could not be reached",
  "model-missing": "the model is not installed",
  "invalid-output": "the model's answer was not valid, even after a retry",
};

const RETRY_WHY: Record<string, string> = {
  "invalid-json": "the model's answer was not valid JSON, asked it to fix it",
  "invalid-schema":
    "the model's answer did not match the expected format, asked it to fix it",
  "cut-off": "the model's answer was cut off, asked it to try again",
};

// --- the plain-English timeline ----------------------------------------------------

export type PlainTone = "info" | "good" | "warn" | "bad" | "muted";

export interface PlainEntry {
  /** Stable across polls (one call keeps its key from start to end). */
  key: string;
  /** Sort key; a call's wake line sits half a step before the call itself. */
  seq: number;
  /** When it started (the line's clock time). */
  ts: number;
  text: string;
  tone: PlainTone;
  /** Still running (the call has started but not ended). */
  pending: boolean;
}

type CallStart = Extract<AiLogEvent, { kind: "call-start" }>;
type CallEnd = Extract<AiLogEvent, { kind: "call-end" }>;

const WOKE_MIN_LOAD_MS = 1000;

/** Did this call have to load the model? start.modelLoaded wins; with no answer
 *  (null) a load_duration above a second says it did. */
function wokeModel(start: CallStart | undefined, end: CallEnd | undefined): boolean {
  if (start?.modelLoaded === false) return true;
  if (start?.modelLoaded === true) return false;
  return (end?.loadMs ?? 0) >= WOKE_MIN_LOAD_MS;
}

function whyFailed(end: CallEnd): string {
  return (
    (end.errorCode && FAILURE_WHY[end.errorCode]) || end.message || "an unexpected error"
  );
}

/** Build the readable timeline: one line per thing that happened, a call's
 *  start and end merged into one line that finishes in place. */
export function buildPlainTimeline(events: AiLogEvent[]): PlainEntry[] {
  const out = new Map<string, PlainEntry>();
  const starts = new Map<string, CallStart>();
  const put = (entry: PlainEntry) => out.set(entry.key, entry);

  for (const e of events) {
    switch (e.kind) {
      case "server-up":
        put({
          key: `e${e.seq}`,
          seq: e.seq,
          ts: e.ts,
          tone: "good",
          pending: false,
          text:
            e.how === "started"
              ? `Started Ollama${e.version ? ` ${e.version}` : ""}. AI OS owns it and stops it when you quit.`
              : e.how === "adopted"
                ? `Took over an Ollama that an earlier AI OS session left running${e.version ? ` (${e.version})` : ""}. AI OS stops it when you quit.`
                : `Connected to an Ollama that was already running${e.version ? ` (${e.version})` : ""}. AI OS will not stop it.`,
        });
        break;
      case "server-down":
        put({
          key: `e${e.seq}`,
          seq: e.seq,
          ts: e.ts,
          tone: "bad",
          pending: false,
          text: e.willRetry
            ? `Could not reach Ollama, will retry. ${e.message}`
            : `Ollama is not available. ${e.message}`,
        });
        break;
      case "server-stop":
        put({
          key: `e${e.seq}`,
          seq: e.seq,
          ts: e.ts,
          tone: "muted",
          pending: false,
          text: e.stopped
            ? "AI OS closed and stopped the Ollama it started."
            : "AI OS closed; the shared Ollama was left running.",
        });
        break;
      case "prewarm-skipped":
        put({
          key: `e${e.seq}`,
          seq: e.seq,
          ts: e.ts,
          tone: "muted",
          pending: false,
          text: "The model is not loaded at start-up: it wakes when something needs it, which saves memory.",
        });
        break;
      case "model-loaded":
        // A load a call or "Load now" caused already has its own "Waking the model" line.
        if (e.cause === "call" || e.cause === "manual") break;
        put({
          key: `e${e.seq}`,
          seq: e.seq,
          ts: e.ts,
          tone: "info",
          pending: false,
          text: e.ours
            ? `The model ${e.model} was already in memory (${aboutBytes(e.sizeBytes)}).`
            : `Another program loaded ${e.model} into Ollama (${aboutBytes(e.sizeBytes)}). AI OS does not manage it.`,
        });
        break;
      case "model-unloaded":
        put({
          key: `e${e.seq}`,
          seq: e.seq,
          ts: e.ts,
          tone: "muted",
          pending: false,
          text: !e.ours
            ? `${e.model} (loaded by another program) left memory.`
            : e.reason === "idle"
              ? `Model went to sleep${e.idleMs ? ` after ${formatIdle(e.idleMs)} idle` : " after sitting idle"}, memory freed (${aboutBytes(e.sizeBytes)}).`
              : e.reason === "manual"
                ? `Model unloaded on request, memory freed (${aboutBytes(e.sizeBytes)}).`
                : e.reason === "shutdown"
                  ? `Model unloaded because AI OS is closing, memory freed (${aboutBytes(e.sizeBytes)}).`
                  : `Model is no longer in memory (${aboutBytes(e.sizeBytes)} freed).`,
        });
        break;
      case "unload-request":
        put({
          key: `e${e.seq}`,
          seq: e.seq,
          ts: e.ts,
          tone: "muted",
          pending: false,
          text:
            e.by === "user"
              ? "Asked Ollama to unload the model now."
              : "Unloading the model before Ollama stops.",
        });
        break;
      case "call-queued": {
        const unit = MESSAGE_TASKS.has(e.task) ? "message" : "request";
        put({
          key: `${e.call}:queued`,
          seq: e.seq,
          ts: e.ts,
          tone: "muted",
          pending: false,
          text: `Queued: ${describeTask(e.task, e.label)}. ${e.waiting} ${unit}${e.waiting === 1 ? "" : "s"} waiting.`,
        });
        break;
      }
      case "call-start": {
        starts.set(e.call, e);
        if (e.task === "load" || e.task === "prewarm") {
          put({
            key: e.call,
            seq: e.seq,
            ts: e.ts,
            tone: "info",
            pending: true,
            text:
              e.modelLoaded === true
                ? "The model is already loaded; checking that it is ready…"
                : `${e.task === "prewarm" ? "Pre-loading the model at start-up" : "Waking the model on request"} (loading ${e.model} into memory)…`,
          });
          break;
        }
        if (e.modelLoaded === false) {
          put({
            key: `${e.call}:wake`,
            seq: e.seq - 0.5,
            ts: e.ts,
            tone: "info",
            pending: true,
            text: `Waking the model (loading ${e.model} into memory)…`,
          });
        }
        put({
          key: e.call,
          seq: e.seq,
          ts: e.ts,
          tone: "info",
          pending: true,
          text: `${describeTask(e.task, e.label)}…`,
        });
        break;
      }
      case "call-retry": {
        const start = starts.get(e.call);
        put({
          key: `${e.call}:retry${e.attempt}`,
          seq: e.seq,
          ts: e.ts,
          tone: "warn",
          pending: false,
          text: `Retrying${start?.label ? ` "${start.label}"` : ""}: ${RETRY_WHY[e.reason] ?? "the model's answer was not usable, asked it to fix it"}.`,
        });
        break;
      }
      case "call-end": {
        const start = starts.get(e.call);
        const ts = start?.ts ?? e.ts;
        const seq = start?.seq ?? e.seq;
        const woke = wokeModel(start, e);
        const loadMs = e.loadMs ?? 0;

        if (e.task === "load" || e.task === "prewarm") {
          const what =
            e.task === "prewarm"
              ? "Pre-loading the model at start-up"
              : "Waking the model on request";
          put({
            key: e.call,
            seq,
            ts,
            pending: false,
            tone: e.ok ? "good" : "bad",
            text: e.ok
              ? woke
                ? `${what} (loading ${e.model} into memory)… ready in ${formatDuration(e.durationMs)}.`
                : `The model is already loaded; it is ready (checked in ${formatDuration(e.durationMs)}).`
              : `${what}… did not work after ${formatDuration(e.durationMs)}: ${whyFailed(e)}.`,
          });
          break;
        }

        if (woke) {
          // The model really did load, unless the call died before it could.
          const wakeFailed = !e.ok && !loadMs && e.errorCode !== "invalid-output";
          put({
            key: `${e.call}:wake`,
            seq: seq - 0.5,
            ts,
            pending: false,
            tone: wakeFailed ? "bad" : "good",
            text: wakeFailed
              ? `Waking the model (loading ${e.model} into memory)… did not finish: ${whyFailed(e)}.`
              : `Waking the model (loading ${e.model} into memory)…${loadMs ? ` ready in ${formatDuration(loadMs)}.` : " ready."}`,
          });
        }
        const phrase = describeTask(e.task, e.label ?? start?.label);
        // With a load in the middle, the "took" figure is the reading, not the wait.
        const took = formatDuration(
          woke && loadMs ? Math.max(0, e.durationMs - loadMs) : e.durationMs,
        );
        put({
          key: e.call,
          seq,
          ts,
          pending: false,
          tone: e.ok
            ? "good"
            : e.errorCode === "timeout" || e.errorCode === "invalid-output"
              ? "warn"
              : "bad",
          text: e.ok
            ? `${phrase}… done in ${took}${e.note ? ` (${e.note})` : ""}.`
            : `${phrase}… failed after ${formatDuration(e.durationMs)}: ${whyFailed(e)}.`,
        });
        break;
      }
    }
  }
  return [...out.values()].sort((a, b) => a.seq - b.seq);
}

/** The timeline as text to copy: "19:31  Waking the model…". */
export function plainToText(entries: PlainEntry[], timeZone?: string): string {
  return entries.map((e) => `${formatClock(e.ts, timeZone)}  ${e.text}`).join("\n");
}

// --- raw lines ---------------------------------------------------------------------

const RAW_KEY: Record<string, string> = {
  durationMs: "duration_ms",
  promptTokens: "prompt_tokens",
  evalTokens: "eval_tokens",
  tokensPerSecond: "tokens_per_second",
  loadMs: "load_ms",
  keepAlive: "keep_alive",
  queueWaiting: "queue_waiting",
  modelLoaded: "model_loaded",
  errorCode: "error_code",
  sizeBytes: "size_bytes",
  expiresAt: "expires_at",
  idleMs: "idle_ms",
  willRetry: "will_retry",
  baseUrl: "base_url",
  position: "queue_position",
  waiting: "queue_waiting",
};

/** Keys in the order a reader wants them; anything else follows alphabetically. */
const RAW_ORDER = [
  "call",
  "task",
  "label",
  "model",
  "ok",
  "attempt",
  "attempts",
  "duration_ms",
  "load_ms",
  "prompt_tokens",
  "eval_tokens",
  "tokens_per_second",
  "keep_alive",
  "think",
  "model_loaded",
  "queue_position",
  "queue_waiting",
];

function rawValue(value: unknown): string {
  if (typeof value === "string")
    return /^[\w.:/\\@-]+$/.test(value) ? value : JSON.stringify(value);
  return String(value);
}

/** One machine-style line: `2026-10-24T19:31:02.123Z INFO  #12 call-end call=c3 ...`. */
export function formatRawLine(event: AiLogEvent): string {
  const { seq, ts, level, kind, ...rest } = event as AiLogEvent & Record<string, unknown>;
  const pairs = Object.entries(rest)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => [RAW_KEY[k] ?? k, v] as const)
    .sort(([a], [b]) => {
      const ia = RAW_ORDER.indexOf(a);
      const ib = RAW_ORDER.indexOf(b);
      if (ia >= 0 || ib >= 0)
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
      return a.localeCompare(b);
    })
    .map(([k, v]) => `${k}=${rawValue(v)}`);
  const stamp = new Date(ts).toISOString();
  return [stamp, level.toUpperCase().padEnd(5), `#${seq}`, kind, ...pairs].join(" ");
}

export type LevelFilter = "all" | "warn" | "error";

/** Apply the level (this level and above) and text filters to the events. */
export function filterEvents(
  events: AiLogEvent[],
  filter: { level?: LevelFilter; text?: string },
): AiLogEvent[] {
  const min: AiLogLevel =
    filter.level === "error" ? "error" : filter.level === "warn" ? "warn" : "info";
  const needle = filter.text?.trim().toLowerCase();
  return events.filter(
    (e) =>
      LEVEL_RANK[e.level] >= LEVEL_RANK[min] &&
      (!needle || formatRawLine(e).toLowerCase().includes(needle)),
  );
}

/** Filter plain server-log lines by text (level does not exist there). */
export function filterLines(lines: string[], text?: string): string[] {
  const needle = text?.trim().toLowerCase();
  return needle ? lines.filter((l) => l.toLowerCase().includes(needle)) : lines;
}

/** "2 min", "30 s", "1 h" for a keep_alive string ("2m"); anything else as is. */
export function formatKeepAlive(keepAlive: string): string {
  const match = /^(\d+)(s|m|h)$/.exec(keepAlive.trim());
  if (!match) return keepAlive;
  const unit = { s: "s", m: "min", h: "h" }[match[2] as "s" | "m" | "h"];
  return `${match[1]} ${unit}`;
}
