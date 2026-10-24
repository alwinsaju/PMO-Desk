// Pure view-models for the PMO window's top bar: the model status chip, the
// notices under it and the reminders prompt. No React, relative imports with
// the .ts extension, so `pnpm test` can load this under plain Node
// (see toolbarView.test.mjs).
import { taskNoun, unloadCountdown } from "../../../lib/ai-runtime/logView.ts";
import { WAKE_NOTE } from "../../../lib/pmo/runtimeSummary.ts";
import type {
  PmoState,
  RuntimeSummary,
  StructuringInfo,
} from "../../../lib/pmo/types.ts";

// --- the model status chip --------------------------------------------------------

/** `waking` = loading into memory for a call; `working` = a call is running. */
export type ModelTone = "ready" | "idle" | "waking" | "working" | "off";

export interface ModelStatus {
  /** Short enough for a chip: "Model asleep", "Loading model…", "Working on a
   *  message", "Model ready", "Model not running". */
  label: string;
  tone: ModelTone;
  /** Everything else, for the tooltip / the overflow menu. */
  detail: string;
  /** The model is working (or waking) right now: the dot pulses. */
  busy: boolean;
  /** "Structuring 1 of 3" while the queue is being worked through, else null. */
  progress: string | null;
  /** What the chip shows: the label, plus "· 1 of 3" while the queue is worked
   *  through, or "· 1:32" (time until it unloads) while the model is loaded and
   *  idle. Short on purpose: the chip shares a narrow row with the actions. */
  chip: string;
  /** ISO time the loaded model unloads, while it is idle in memory; the toolbar
   *  ticks the countdown itself between polls. */
  unloadsAt: string | null;
}

export function modelStatus(
  state: Pick<PmoState, "runtime" | "structuring">,
  nowMs: number = Date.now(),
): ModelStatus {
  const { runtime, structuring } = state;
  const { paused } = structuring;

  let label: string;
  let tone: ModelTone;
  if (
    paused?.code === "model-missing" ||
    (!paused && runtime.state === "model-missing")
  ) {
    label = "Model missing";
    tone = "off";
  } else if (paused || runtime.state === "down") {
    label = "Model not running";
    tone = "off";
  } else if (runtime.state === "loading") {
    label = "Loading model…";
    tone = "waking";
  } else if (runtime.state === "working") {
    label = `Working on ${taskNoun(runtime.task)}`;
    tone = "working";
  } else if (runtime.state === "ready") {
    label = "Model ready";
    tone = "ready";
  } else if (runtime.state === "asleep") {
    // The normal idle state, not a warning: the model loads when it is needed.
    label = "Model asleep";
    tone = "idle";
  } else if (runtime.state === "stub") {
    label = "Test stub";
    tone = "idle";
  } else {
    label = "Model status unknown";
    tone = "idle";
  }

  const countdown =
    !paused && runtime.state === "ready"
      ? unloadCountdown(runtime.unloadsAt, nowMs)
      : null;
  const working = !paused && (runtime.state === "loading" || runtime.state === "working");

  const parts: string[] = [];
  parts.push(
    tone === "off" || runtime.state === "ready"
      ? label.replace(/^Model /, "Local model ")
      : label.replace(/…$/, ""),
  );
  if (runtime.model) parts.push(runtime.model);
  if (!paused && runtime.state === "asleep") {
    parts.push(`loads when a message needs it. ${WAKE_NOTE}`);
  } else if (!paused && runtime.state === "loading") {
    parts.push(WAKE_NOTE);
  } else if (countdown) {
    parts.push(`unloads in ${countdown} if nothing else needs it`);
  }
  if (structuring.total > 0 && !paused) {
    parts.push(`structuring ${structuring.position} of ${structuring.total}`);
  }
  const progress =
    structuring.total > 0 && !paused
      ? `Structuring ${structuring.position} of ${structuring.total}`
      : null;
  return {
    label,
    tone,
    detail: parts.join(" · "),
    busy: working,
    progress,
    chip:
      working && structuring.total > 1
        ? `${label} · ${structuring.position} of ${structuring.total}`
        : countdown
          ? `${label} · ${countdown}`
          : label,
    unloadsAt: !paused && runtime.state === "ready" ? (runtime.unloadsAt ?? null) : null,
  };
}

/** The line in the proposal dialog while a message waits for the model. */
export function proposalWaitNote(
  runtime: Pick<RuntimeSummary, "state">,
  paused: StructuringInfo["paused"],
): string {
  if (paused) {
    return "Waiting for the local model to come back. This will be structured automatically.";
  }
  if (runtime.state === "loading") {
    return `The local model is waking up to read this message. ${WAKE_NOTE}`;
  }
  if (runtime.state === "asleep") {
    return `The local model is asleep and will wake up to read this message. ${WAKE_NOTE}`;
  }
  return "The local model has not finished with this message yet.";
}

// --- notices -------------------------------------------------------------------------

export interface Notice {
  /** Stable, so the list keeps its identity across polls. */
  id: string;
  /** "attention" = nothing will work until it is dealt with. */
  level: "attention" | "info";
  text: string;
  /** Offers a link to this place after the text. */
  action?: "settings";
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** What needs the user's attention under the toolbar, most urgent first.
 *  Nothing is returned for a healthy system. */
export function buildNotices(
  state: Pick<PmoState, "ingest" | "runtime" | "structuring">,
  offline: boolean,
): Notice[] {
  const { ingest, runtime, structuring } = state;
  const { paused } = structuring;
  const out: Notice[] = [];

  if (offline) {
    out.push({
      id: "offline",
      level: "attention",
      text: "Can't reach the AI OS server right now. Showing the last known state.",
    });
  }
  if (paused) {
    const waiting = structuring.waiting + (structuring.active ? 1 : 0);
    out.push({
      id: "paused",
      level: "attention",
      text:
        paused.code === "model-missing"
          ? `${paused.message} Messages stay pending and are structured once the model is installed.`
          : `Local model not running. ${waiting > 0 ? waiting : "Some"} ${plural(
              waiting,
              "item is",
              "items are",
            )} waiting and stay pending; they are retried on every scan.`,
    });
  } else if (
    (runtime.state === "down" || runtime.state === "model-missing") &&
    runtime.message
  ) {
    out.push({ id: "runtime", level: "attention", text: runtime.message });
  } else if (
    (runtime.state === "loading" || runtime.state === "asleep") &&
    structuring.total > 0 &&
    runtime.message
  ) {
    // Asleep is the normal idle state; it only deserves a word while a message is
    // waiting for the model to wake (the first one takes 1-2 minutes longer).
    out.push({ id: "waking", level: "info", text: runtime.message });
  }
  if (!ingest.inboxExists && ingest.lastScanAt) {
    out.push({
      id: "inbox",
      level: "attention",
      text: `Inbox folder not found: ${ingest.inboxDir}. Nothing can arrive until it exists.`,
    });
  }
  if (runtime.state === "stub" && runtime.message) {
    out.push({ id: "stub", level: "info", text: runtime.message });
  }
  if (ingest.teamsFiltering) {
    out.push({
      id: "teams",
      level: "info",
      text: "Teams messages are filtered until a tenant ID or chat is allowlisted (pasted text is not affected).",
      action: "settings",
    });
  }
  if (ingest.rejectedFileCount > 0) {
    const n = ingest.rejectedFileCount;
    out.push({
      id: "rejected",
      level: "info",
      text: `${n} producer ${plural(n, "file", "files")} could not be read and ${plural(
        n,
        "was",
        "were",
      )} parked in rejected-files with a reason.`,
    });
  }
  const rank = { attention: 0, info: 1 } as const;
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

/** One line for the result of "Scan now". */
export function scanSummary(report: {
  ingested: number;
  duplicates: number;
  filtered: number;
  rejected: number;
}): string {
  const parts = [`${report.ingested} new`];
  if (report.duplicates) parts.push(`${report.duplicates} duplicate`);
  if (report.filtered) parts.push(`${report.filtered} filtered`);
  if (report.rejected) parts.push(`${report.rejected} unreadable`);
  return parts.join(", ");
}

// --- reminders ---------------------------------------------------------------------------

export type ReminderPermission = NotificationPermission | "unsupported" | "unknown";

/** Whether the toolbar should offer "Enable reminders": only in a browser tab
 *  that has not been asked yet. Everything else is explained in Settings. */
export function offersReminderPrompt(
  permission: ReminderPermission,
  desktop: boolean,
): boolean {
  return !desktop && permission === "default";
}

const CAVEAT =
  "Browser reminders only fire while this tab is open; the AI OS desktop app is the reliable way to get them.";

/** The plain-words status shown in Settings, under Reminders. */
export function reminderStatus(
  permission: ReminderPermission,
  desktop: boolean,
  attention: number,
): { title: string; text: string } | null {
  if (desktop) {
    return {
      title: "Reminders are delivered by the desktop app.",
      text: "They fire even with the PMO window closed.",
    };
  }
  switch (permission) {
    case "unknown":
      return null;
    case "granted":
      return { title: "Browser notifications are on.", text: CAVEAT };
    case "default":
      return { title: "Browser notifications are off.", text: CAVEAT };
    case "denied":
      return {
        title: "Notifications are blocked for this site.",
        text: `Reminders show as the badge on the dock icon${
          attention > 0 ? ` (${attention})` : ""
        } and a count in the tab title. To get pop-ups, allow notifications in the browser's site settings. ${CAVEAT}`,
      };
    case "unsupported":
      return {
        title: "This browser cannot show notifications.",
        text: `Reminders show as the badge on the dock icon and a count in the tab title. ${CAVEAT}`,
      };
  }
}
