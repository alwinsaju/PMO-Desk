import type { ActionResult, Agent, HistoryRun, LogEntry, Task } from "./types";

/**
 * Base URL of the agent-office FastAPI backend — a separate, already-running
 * system this app is a live client of (see
 * `C:\Projects\Agents-workspace\agent-office\backend`, read-only reference).
 * A single named constant rather than a literal repeated at every call
 * site; override via `NEXT_PUBLIC_AGENT_OFFICE_API_URL` if it ever runs
 * somewhere other than the default. Its CORS is already wide open
 * (`allow_origins=["*"]`), so this calls it directly with no proxy.
 */
export const AGENT_OFFICE_API_URL =
  process.env.NEXT_PUBLIC_AGENT_OFFICE_API_URL?.trim() || "http://localhost:8000";

/** Every request is time-boxed so a half-dead connection (e.g. the backend
 *  restarting mid keep-alive) rejects promptly instead of hanging the poll
 *  loop — see useAgentOfficeData's catch path. */
const REQUEST_TIMEOUT_MS = 8000;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${AGENT_OFFICE_API_URL}${path}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function postAction(path: string): Promise<ActionResult> {
  const res = await fetch(`${AGENT_OFFICE_API_URL}${path}`, {
    method: "POST",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json() as Promise<ActionResult>;
}

/** All discovered tasks with their live state. */
export function fetchTasks(): Promise<Task[]> {
  return getJson<Task[]>("/tasks");
}

/** All pool workers with their live state — used only to derive whether
 *  any worker is idle (see taskPresenter.ts's `canStartFromAgents`); never
 *  rendered as its own panel. */
export function fetchAgents(): Promise<Agent[]> {
  return getJson<Agent[]>("/agents");
}

/** This task's past runs, newest first. The endpoint replies
 *  `{ok: false, reason}` for an unknown task id instead of an HTTP error,
 *  so that case just yields an empty list here rather than throwing. */
export async function fetchTaskHistory(taskId: string): Promise<HistoryRun[]> {
  const result = await getJson<{ ok: boolean; runs?: HistoryRun[]; reason?: string }>(
    `/tasks/${encodeURIComponent(taskId)}/history`,
  );
  return result.ok && result.runs ? result.runs : [];
}

/** This task's live/most-recent per-step output. The endpoint's response
 *  shape is polymorphic: a plain array on success, or `{ok: false, reason}`
 *  for an unknown task id — narrowed here to always resolve an array. */
export async function fetchTaskLog(taskId: string): Promise<LogEntry[]> {
  const result = await getJson<LogEntry[] | { ok: false; reason: string }>(
    `/tasks/${encodeURIComponent(taskId)}/log`,
  );
  return Array.isArray(result) ? result : [];
}

// ---------------------------------------------------------------------------
// State-machine actions. Each is a bare POST with no body, matching the
// backend's actual route signatures exactly (see main.py) — none of them
// take a request body. SAFETY: these five call a real backend that really
// starts pipelines and really sends real email (see the task brief) with no
// auth in front of it. This module only ever DEFINES the calls; see
// useTaskAction.ts for the one place they're actually invoked, and the
// project's verification notes for how these were checked without ever
// triggering them for real.
// ---------------------------------------------------------------------------

/** Starts a task's pipeline on an idle worker. Also used for "Retry" from
 *  the error state — the backend itself distinguishes fresh-start from
 *  retry by the task's current state (see main.py's start_task). */
export function startTask(taskId: string): Promise<ActionResult> {
  return postAction(`/tasks/${encodeURIComponent(taskId)}/start`);
}

/** Approves a task paused at its review gate. */
export function approveTask(taskId: string): Promise<ActionResult> {
  return postAction(`/tasks/${encodeURIComponent(taskId)}/approve`);
}

/** Rejects a task paused at its review gate, sending it back to resting. */
export function rejectTask(taskId: string): Promise<ActionResult> {
  return postAction(`/tasks/${encodeURIComponent(taskId)}/reject`);
}

/** Confirms a task paused at its send gate. This is the call that can
 *  trigger a real, irreversible email send. */
export function sendTask(taskId: string): Promise<ActionResult> {
  return postAction(`/tasks/${encodeURIComponent(taskId)}/send`);
}

/** Resets a task back to resting (clears an error, or force-clears a hung
 *  working/finishing run). */
export function resetTask(taskId: string): Promise<ActionResult> {
  return postAction(`/tasks/${encodeURIComponent(taskId)}/reset`);
}

/** Tells the backend (running locally on this same machine) to open a
 *  notification's output artifact with the OS default app. Safe/local —
 *  not one of the five state-machine actions above. */
export function openTaskNotification(
  taskId: string,
  notificationId: string,
): Promise<ActionResult> {
  return postAction(
    `/tasks/${encodeURIComponent(taskId)}/notifications/${encodeURIComponent(notificationId)}/open`,
  );
}
