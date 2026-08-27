/**
 * Shapes returned by the agent-office FastAPI backend (see
 * `C:\Projects\Agents-workspace\agent-office\backend\main.py`, read-only
 * reference — this app never modifies that codebase). Kept intentionally
 * narrow: only the fields this app actually renders are declared, and
 * anything the backend treats as an open-ended per-task manifest (step
 * ids/types) stays typed as plain strings rather than a guessed-at union.
 */

/**
 * The task state machine's states, exactly as returned by `Task.to_dict()`
 * in main.py — resting -> working -> (awaiting_review ->)? (awaiting_send
 * ->)? finishing -> back to resting, or error at any point. There is no
 * separate "done" state: a completed run just returns the task to
 * "resting" (see `_finish_task`).
 */
export type TaskState =
  "resting" | "working" | "awaiting_review" | "awaiting_send" | "finishing" | "error";

export interface TaskStep {
  id: string;
  /** "python" | "powershell" | "review" | "confirm" in every task seen so
   *  far, but the backend never validates this against a closed set until
   *  a step actually runs — treated here as an opaque per-task manifest
   *  value. Only "review" and "confirm" are ever treated specially (as a
   *  human-attention gate); everything else renders as a normal step. */
  type: string;
}

export interface TaskNotification {
  id: string;
  /** "task.review_ready" | "task.completed" | "task.failed" in practice. */
  kind: string;
  title: string;
  body: string;
  outputPath: string | null;
  createdAt: string;
}

export interface Task {
  id: string;
  displayName: string;
  state: TaskState;
  error: string | null;
  currentStep: string | null;
  assignedAgentId: string | null;
  steps: TaskStep[];
  notifications: TaskNotification[];
  schedule: { daily: string } | null;
}

/** One pool worker. This app only ever uses it to compute whether any
 *  worker is idle (see taskPresenter.ts's `canStartFromAgents`) — never
 *  rendered as a standalone panel (explicitly out of scope for this pass),
 *  and no longer used for an id -> displayName lookup now that task status
 *  text doesn't name the assigned worker. */
export interface Agent {
  id: string;
  displayName: string;
  state: string;
  currentTaskId: string | null;
  currentTaskName: string | null;
  currentStep: string | null;
}

/** One past run record from GET /tasks/{id}/history, newest first. */
export interface HistoryRun {
  run_id: string;
  task_id: string;
  task_name: string | null;
  agent_id: string | null;
  agent_name: string | null;
  runtime: string;
  started_at: string;
  ended_at: string;
  outcome: "completed" | "failed" | string;
  current_step_at_end: string | null;
  error: string | null;
  steps_completed: string[];
}

/** One line of a task's live/most-recent per-step output, from
 *  GET /tasks/{id}/log. */
export interface LogEntry {
  step: string;
  /** "stdout" | "stderr" | "cmd" in practice. */
  stream: string;
  text: string;
}

/** Every POST action endpoint (start/approve/reject/send/reset, and
 *  notifications/{id}/open) replies with this same small shape — `ok:
 *  false` is a legitimate, non-exceptional response (e.g. "no idle
 *  agents"), not a thrown error. */
export interface ActionResult {
  ok: boolean;
  reason?: string;
}
