/**
 * Lifecycle of one agent task. There is at most one task "in flight" at a
 * time (see agentStore.ts's `currentTask`) — this is a single-agent shell
 * (no queue, no parallel tasks), not a real multi-task scheduler.
 *
 * "thinking" is the one phase with genuinely unknown duration — it lasts
 * exactly as long as the real `/api/ai/command` request takes (local
 * inference latency varies a lot; see that route's own doc comment), not a
 * fixed timer. "working" only applies to a validated ACTION decision, once
 * the model has replied and the target note action is being applied/shown
 * (see CommandBar.tsx) — a plain conversational reply goes straight from
 * "thinking" to "completed" instead, since there's nothing further to
 * apply.
 */
export type AgentTaskStatus = "thinking" | "working" | "completed";

export interface AgentTask {
  id: string;
  /** The window that was focused when this task was submitted — see
   *  agentStore.ts's `startTask`. Deliberately just an id: nothing in this
   *  layer reaches into a specific app's DOM, it only ever reads generic
   *  window geometry (position/size) via windowStore, plus (for Notes)
   *  that app's own public store contract — see CommandBar.tsx. */
  windowId: string;
  /** Raw text the user typed into CommandBar, sent to the AI verbatim.
   *  Stored here purely as the TaskList row's fallback label — see
   *  `summary` below for what actually happened. */
  prompt: string;
  status: AgentTaskStatus;
  createdAt: number;
  /** Set the moment `status` flips to "completed". */
  completedAt?: number;
  /** A short, human-readable description of what actually happened, set
   *  once the task completes — the real action taken (e.g. "Creating a
   *  note: "Buy milk"…") or the AI's conversational reply text. TaskList
   *  falls back to `prompt` when this is absent (there's no real outcome
   *  text yet for a task still in flight). */
  summary?: string;
}

/**
 * A point in viewport coordinates. `windowStore`'s `position` values are
 * already viewport-relative (Desktop.tsx has no document-level scroll —
 * see ARCHITECTURE.md), so this is interchangeable with a window's
 * `position` but named/defined independently here since it's also used
 * for points that aren't a window's origin at all (a cursor target, an
 * annotation anchor, the command bar's own on-screen center).
 */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** A short canned callout anchored to a point on screen — see
 *  AIAnnotationBubble.tsx. */
export interface AgentAnnotation {
  message: string;
  /** The point the bubble's tail points at. */
  position: ScreenPoint;
}
