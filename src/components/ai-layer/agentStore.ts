import { create } from "zustand";
import type { AgentAnnotation, AgentTask, ScreenPoint } from "./types";

/**
 * No `"use client"` here, deliberately — same as `windowStore.ts`. This
 * file imports nothing but `zustand` and plain local types, so it's safe
 * to evaluate anywhere; every actual consumer (CommandBar, AICursor,
 * PresenceAvatars, ...) is already a Client Component in its own right
 * (hooks/JSX require it), so this store is always reached through an
 * already-crossed client boundary. See ARCHITECTURE.md's third gotcha for
 * the failure mode this avoids — it's specifically about files that
 * import live component values (icons, etc.), which this file does not.
 */
export interface AgentStoreState {
  /** The task currently "in flight" — null when idle. Its `status` drives
   *  AgentStatusBadge's pill and the AI presence avatar's active/idle
   *  ring. Only ever one at a time: this is a mocked single-agent shell. */
  currentTask: AgentTask | null;
  /** Completed tasks, most recent first. Rendered by TaskList — collapsed
   *  and hidden by default, per the reference product's clean default
   *  screen. */
  taskHistory: AgentTask[];
  /** Where AICursor should glide to; null hides the cursor entirely. */
  cursorTarget: ScreenPoint | null;
  /** The command bar's own on-screen center, measured by CommandBar
   *  itself (see its layout effect). AICursor's glide starts here, so the
   *  cursor visibly "comes from" the command bar every time a task
   *  starts, not just on first mount. */
  commandBarAnchor: ScreenPoint | null;
  /** The short canned callout near the window being "worked on". */
  annotation: AgentAnnotation | null;
  /** Collapsed by default — expanded by clicking the AI's presence avatar
   *  (see PresenceAvatars.tsx). */
  isTaskListExpanded: boolean;

  /** Starts a new task against `windowId` and returns it (its `id` is the
   *  mock `aiTaskId` to hand to `windowStore.setWindowControlledBy`). */
  startTask: (input: { windowId: string; prompt: string }) => AgentTask;
  /** Flips the current task to "completed" and unshifts it into
   *  `taskHistory`. No-ops if there's no current task. */
  completeCurrentTask: () => void;
  /** Clears the current task entirely (back to "Idle"). Separate from
   *  `completeCurrentTask` so the badge can sit on "Completed" for a beat
   *  before the whole sequence resets — see CommandBar's timers. */
  clearCurrentTask: () => void;
  setCursorTarget: (point: ScreenPoint | null) => void;
  setCommandBarAnchor: (point: ScreenPoint) => void;
  setAnnotation: (annotation: AgentAnnotation | null) => void;
  toggleTaskList: () => void;
  setTaskListExpanded: (expanded: boolean) => void;
}

function generateTaskId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const useAgentStore = create<AgentStoreState>()((set) => ({
  currentTask: null,
  taskHistory: [],
  cursorTarget: null,
  commandBarAnchor: null,
  annotation: null,
  isTaskListExpanded: false,

  startTask: ({ windowId, prompt }) => {
    const task: AgentTask = {
      id: generateTaskId(),
      windowId,
      prompt,
      status: "working",
      createdAt: Date.now(),
    };
    set({ currentTask: task });
    return task;
  },

  completeCurrentTask: () => {
    set((state) => {
      if (!state.currentTask) return state;
      const completed: AgentTask = {
        ...state.currentTask,
        status: "completed",
        completedAt: Date.now(),
      };
      return {
        currentTask: completed,
        taskHistory: [completed, ...state.taskHistory],
      };
    });
  },

  clearCurrentTask: () => set({ currentTask: null }),

  setCursorTarget: (point) => set({ cursorTarget: point }),

  setCommandBarAnchor: (point) => set({ commandBarAnchor: point }),

  setAnnotation: (annotation) => set({ annotation }),

  toggleTaskList: () =>
    set((state) => ({ isTaskListExpanded: !state.isTaskListExpanded })),

  setTaskListExpanded: (expanded) => set({ isTaskListExpanded: expanded }),
}));
