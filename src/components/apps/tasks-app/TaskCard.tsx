"use client";

import { memo, useCallback } from "react";
import { Button } from "@/components/ui";
import { diffSummary } from "./diffView";
import { flagsSummary } from "./flagsView";
import { formSummary } from "./formGate";
import { StepTracker } from "./StepTracker";
import { TaskActions } from "./TaskActions";
import { TaskStateBadge } from "./TaskStateBadge";
import { statusSentence } from "./taskPresenter";
import { useGateData, type GateData } from "./useGateData";
import type { Task } from "./types";

interface TaskCardProps {
  task: Task;
  /** Called after any action on this card settles, so the caller can
   *  refetch immediately instead of waiting for the next poll tick. */
  onSettled: () => void;
  onOpenDetail: (taskId: string) => void;
  /** Position in the grid — only staggers the entrance animation. */
  index?: number;
}

/**
 * One task's live card: name + state badge, the segmented step progress bar,
 * a one-line status sentence (or, when `state === "error"`, the failure text
 * in a red box instead), and exactly the action buttons legal for this state.
 * Every card is the same size: the grid (TasksApp) gives all rows an equal
 * height, so the title and the error text truncate (ellipsis / 2-line clamp)
 * and the footer is pinned to the bottom. See taskPresenter.ts and
 * TaskActionBar.tsx for where the actual reference-frontend rules live.
 */
export const TaskCard = memo(function TaskCard({
  task,
  onSettled,
  onOpenDetail,
  index = 0,
}: TaskCardProps) {
  const taskId = task.id;
  const openDetail = useCallback(() => onOpenDetail(taskId), [onOpenDetail, taskId]);
  // Data behind a form/flags/diff gate, when the task is waiting at one
  // (always idle for the four older tasks). Action decisions — the legacy
  // incident-review check, the Run form, gate blocks — live in TaskActions.
  const gate = useGateData(task);
  const gateLine = gateSummary(gate);

  return (
    <article
      data-task-card
      style={{ animationDelay: `${Math.min(index, 8) * 70}ms` }}
      className="spot animate-rise rounded-card border-line bg-card flex min-w-0 flex-col border px-5 pt-5 pb-4"
    >
      <header className="flex items-center gap-2.5">
        <h3
          title={task.displayName}
          className="text-ink min-w-0 flex-1 truncate text-[16.5px] font-bold tracking-[-0.015em]"
        >
          {task.displayName}
        </h3>
        <TaskStateBadge state={task.state} className="shrink-0" />
      </header>

      <div className="mt-4 mb-3.5">
        <StepTracker task={task} />
      </div>

      {task.state === "error" && task.error ? (
        <div
          className="rounded-control bg-red-soft text-red px-3 py-2"
          title={task.error}
        >
          <p className="line-clamp-2 font-mono text-[11.5px] leading-normal [overflow-wrap:anywhere]">
            {task.error}
          </p>
        </div>
      ) : (
        <p className="text-ink-soft line-clamp-2 min-h-5 text-[13.5px]">
          {statusSentence(task)}
        </p>
      )}

      {gateLine && (
        <p
          className="text-ink mt-1.5 line-clamp-2 text-[12px] font-medium"
          aria-live="polite"
        >
          {gateLine}
        </p>
      )}

      <footer className="mt-auto flex flex-wrap items-end gap-x-2 gap-y-2 pt-3.5">
        <div className="min-w-0 flex-1">
          <TaskActions
            task={task}
            onSettled={onSettled}
            onOpenDetail={openDetail}
            gate={gate}
          />
        </div>
        <Button variant="ghost" onClick={openDetail} className="ml-auto shrink-0">
          Details
        </Button>
      </footer>
    </article>
  );
});

/** One-line "what's waiting" summary under the status sentence — only for
 *  tasks paused at a form/flags/diff gate whose data has loaded. */
function gateSummary(gate: GateData): string | null {
  if (gate.status !== "ready") return null;
  if (gate.gate === "form" && gate.form) {
    return formSummary(gate.form.schema, gate.form.pending);
  }
  if (gate.gate === "flags" && gate.flags) return flagsSummary(gate.flags);
  if (gate.gate === "diff" && gate.diff) {
    return gate.diff.blocking?.length
      ? `${gate.diff.blocking.length} blocking issue${gate.diff.blocking.length === 1 ? "" : "s"} — can't confirm`
      : diffSummary(gate.diff);
  }
  return null;
}
