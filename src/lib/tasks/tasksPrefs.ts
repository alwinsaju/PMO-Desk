/** The Tasks app's saved preferences: schedules, send-later queue, run snapshots and small memories. Pure. */
import { sanitizeSnapshots, type RunSnapshot } from "./inputCheck.ts";
import type { Recipients } from "./recipientCheck.ts";
import { sanitizeQueue, type QueuedSend } from "./sendQueue.ts";
import { sanitizeSchedules, type TaskSchedule } from "./taskSchedule.ts";

export interface TasksPrefs {
  schedules: TaskSchedule[];
  /** Task id -> the last scheduled day that was already prepared or reported. */
  handled: Record<string, string>;
  /** When the scheduler last looked, ISO ("" = never). */
  checkedAt: string;
  snapshots: RunSnapshot[];
  /** Task id -> the recipients that were last confirmed or queued. */
  recipients: Record<string, Recipients>;
  queue: QueuedSend[];
  /** A toast (and a system notice while the window is hidden) when a task needs you or finishes. */
  notifyOnFinish: boolean;
  /** "taskId:inputId" -> the file name last uploaded. */
  lastFiles: Record<string, string>;
}

export const DEFAULT_TASKS_PREFS: TasksPrefs = {
  schedules: [],
  handled: {},
  checkedAt: "",
  snapshots: [],
  recipients: {},
  queue: [],
  notifyOnFinish: true,
  lastFiles: {},
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const MAX_KEYS = 40;

function stringMap(value: unknown, max = 200): Record<string, string> {
  if (!isObject(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (Object.keys(out).length >= MAX_KEYS) break;
    if (typeof v === "string") out[k.slice(0, 120)] = v.slice(0, max);
  }
  return out;
}

function recipientMap(value: unknown): Record<string, Recipients> {
  if (!isObject(value)) return {};
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 100) : [];
  const out: Record<string, Recipients> = {};
  for (const [k, v] of Object.entries(value)) {
    if (Object.keys(out).length >= MAX_KEYS) break;
    if (isObject(v)) out[k.slice(0, 120)] = { to: list(v.to), cc: list(v.cc) };
  }
  return out;
}

export function sanitizeTasksPrefs(value: unknown): TasksPrefs {
  const raw = isObject(value) ? value : {};
  return {
    schedules: sanitizeSchedules(raw.schedules),
    handled: stringMap(raw.handled, 10),
    checkedAt:
      typeof raw.checkedAt === "string" && !Number.isNaN(Date.parse(raw.checkedAt))
        ? raw.checkedAt
        : "",
    snapshots: sanitizeSnapshots(raw.snapshots),
    recipients: recipientMap(raw.recipients),
    queue: sanitizeQueue(raw.queue),
    notifyOnFinish: typeof raw.notifyOnFinish === "boolean" ? raw.notifyOnFinish : true,
    lastFiles: stringMap(raw.lastFiles),
  };
}
