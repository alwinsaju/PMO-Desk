import type {
  ActionResult,
  Agent,
  DiffPayload,
  FlagsPayload,
  FormAnswerPatch,
  FormPayload,
  HistoryRun,
  InputsPayload,
  LogEntry,
  OptionsPayload,
  Reply,
  ReviewQueue,
  Task,
  UploadPayload,
} from "./types";

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
 *  not one of the five state-machine actions above. With `path` it opens
 *  that one of the notification's `outputPaths` (the backend refuses any
 *  path the notification doesn't list); without it, the primary file. */
export function openTaskNotification(
  taskId: string,
  notificationId: string,
  path?: string,
): Promise<ActionResult> {
  const base = `/tasks/${encodeURIComponent(taskId)}/notifications/${encodeURIComponent(notificationId)}/open`;
  return postAction(
    path === undefined ? base : `${base}?path=${encodeURIComponent(path)}`,
  );
}

/** The incidents awaiting human Subcategory2 classification for a task,
 *  plus the option vocabulary and a live pending count. Tasks with no
 *  review queue reply `{ok:true, count:0, incidents:[]}` — normalized here
 *  to an empty ReviewQueue. */
export async function fetchReviewIncidents(taskId: string): Promise<ReviewQueue> {
  const result = await getJson<
    | {
        ok: boolean;
        count?: number;
        pending?: number;
        options?: string[];
        incidents?: ReviewQueue["incidents"];
      }
    | { ok: false; reason: string }
  >(`/tasks/${encodeURIComponent(taskId)}/review-incidents`);
  if (!("incidents" in result) || !result.incidents) {
    return { count: 0, pending: 0, options: [], incidents: [] };
  }
  return {
    count: result.count ?? result.incidents.length,
    pending:
      result.pending ?? result.incidents.filter((i) => !i.resolved_subcategory2).length,
    options: result.options ?? [],
    incidents: result.incidents,
  };
}

/** Persists the human's Subcategory2 choices for a task's review queue.
 *  The backend writes them to the task's output/review-resolutions.json,
 *  which the refresh step folds into the staging workbook. */
export async function postReviewResolutions(
  taskId: string,
  resolutions: { number: string; subcategory2: string }[],
): Promise<ActionResult> {
  const res = await fetch(
    `${AGENT_OFFICE_API_URL}/tasks/${encodeURIComponent(taskId)}/review-resolutions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolutions }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (!res.ok) throw new Error(`POST review-resolutions failed: ${res.status}`);
  return res.json() as Promise<ActionResult>;
}

// ---------------------------------------------------------------------------
// Task platform endpoints (agent-apps/TASK-PLATFORM-CONTRACT.md section 2):
// inputs/upload/prepare/options/params for the start form, form/diff/flags
// for the human gates. All reply `{ok, reason?, ...}`. Unlike the helpers
// above these NEVER throw: a missing route (an older backend still running
// the pre-platform code answers 404), a network failure or a timeout all
// collapse into `{ok: false, reason}` so every caller has a single failure
// path and the four older tasks never see any of it.
// ---------------------------------------------------------------------------

/** Upload bodies can be tens of MB over a local socket. */
const UPLOAD_TIMEOUT_MS = 120_000;
/** The backend gives `prepare` 120 s itself; allow a little more so its own
 *  `{ok:false, reason, stderr_tail}` wins the race against our abort. */
const PREPARE_TIMEOUT_MS = 150_000;

interface CallOptions {
  method?: "GET" | "POST";
  body?: BodyInit;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

function failure<T extends object>(reason: string): Reply<T> {
  // `{ok, reason}` is a valid Reply for every T (all payload fields are
  // optional), but TS can't see that through the generic Partial<T>.
  return { ok: false, reason } as Reply<T>;
}

async function callJson<T extends object>(
  path: string,
  { method = "GET", body, headers, timeoutMs = REQUEST_TIMEOUT_MS }: CallOptions = {},
): Promise<Reply<T>> {
  try {
    const res = await fetch(`${AGENT_OFFICE_API_URL}${path}`, {
      method,
      body,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return failure<T>(
        res.status === 404
          ? "The running agent-office backend doesn't support this yet — restart it to pick up the new version."
          : `The backend rejected the request (HTTP ${res.status}).`,
      );
    }
    return (await res.json()) as Reply<T>;
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return failure<T>(
      timedOut ? "The backend took too long to respond." : "Couldn't reach the backend.",
    );
  }
}

function postJsonBody(value: unknown): Pick<CallOptions, "body" | "headers"> {
  return {
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json" },
  };
}

const taskPath = (taskId: string) => `/tasks/${encodeURIComponent(taskId)}`;

/** Live status of each declared input plus any saved select values. */
export function getInputs(taskId: string): Promise<Reply<InputsPayload>> {
  return callJson<InputsPayload>(`${taskPath(taskId)}/inputs`);
}

/** Uploads one file input (multipart field `file`). Only accepted while the
 *  task is resting; the backend re-checks extension, size and destination. */
export function uploadInput(
  taskId: string,
  inputId: string,
  file: File,
): Promise<Reply<UploadPayload>> {
  const form = new FormData();
  form.append("file", file, file.name);
  return callJson<UploadPayload>(
    `${taskPath(taskId)}/upload?input=${encodeURIComponent(inputId)}`,
    { method: "POST", body: form, timeoutMs: UPLOAD_TIMEOUT_MS },
  );
}

/** Runs the task's read-only `prepare` script, which writes options.json;
 *  replies with the parsed options (or `reason` + `stderr_tail`). */
export function prepare(taskId: string): Promise<Reply<OptionsPayload>> {
  return callJson<OptionsPayload>(`${taskPath(taskId)}/prepare`, {
    method: "POST",
    timeoutMs: PREPARE_TIMEOUT_MS,
  });
}

/** The options file as last written by `prepare` (null if never run). */
export function getOptions(taskId: string): Promise<Reply<OptionsPayload>> {
  return callJson<OptionsPayload>(`${taskPath(taskId)}/options`);
}

/** Saves the start form's select values (`{inputId: value}`); the backend
 *  refuses a value that is missing from, or disabled in, the options file. */
export function saveParams(
  taskId: string,
  params: Record<string, string>,
): Promise<Reply<object>> {
  return callJson<object>(`${taskPath(taskId)}/params`, {
    method: "POST",
    ...postJsonBody({ params }),
  });
}

/** The form gate's schema, the saved answers and the ids still pending. */
export function getForm(taskId: string): Promise<Reply<FormPayload>> {
  return callJson<FormPayload>(`${taskPath(taskId)}/form`);
}

/** Merges answers (`{fieldId: value}`) into the saved answers file; a
 *  `null` value clears that answer. */
export function saveForm(
  taskId: string,
  answers: FormAnswerPatch,
): Promise<Reply<{ pending: string[] }>> {
  return callJson<{ pending: string[] }>(`${taskPath(taskId)}/form`, {
    method: "POST",
    ...postJsonBody({ answers }),
  });
}

/** The diff gate's roster-diff.json (null if not written yet). */
export function getDiff(taskId: string): Promise<Reply<DiffPayload>> {
  return callJson<DiffPayload>(`${taskPath(taskId)}/diff`);
}

/** The draft review gate's flags.json (null if not written yet). */
export function getFlags(taskId: string): Promise<Reply<FlagsPayload>> {
  return callJson<FlagsPayload>(`${taskPath(taskId)}/flags`);
}
