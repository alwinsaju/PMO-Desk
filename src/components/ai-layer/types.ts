/**
 * Lifecycle of one mocked agent task. There is at most one task "in
 * flight" at a time (see agentStore.ts's `currentTask`) — this is a mocked
 * single-agent shell, not a real multi-task scheduler.
 */
export type AgentTaskStatus = "working" | "completed";

export interface AgentTask {
  id: string;
  /** The window this task ran against — see agentStore.ts's `startTask`.
   *  Deliberately just an id: nothing in this layer reaches into a
   *  specific app's DOM, it only ever reads generic window geometry
   *  (position/size) via windowStore. */
  windowId: string;
  /** Raw text the user typed into CommandBar. Never parsed or "understood"
   *  — this is a mocked shell, not a real agent, so this is stored purely
   *  for display in TaskList. */
  prompt: string;
  status: AgentTaskStatus;
  createdAt: number;
  /** Set the moment `status` flips from "working" to "completed". */
  completedAt?: number;
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
