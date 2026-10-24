"use client";

import { memo, useCallback } from "react";
import { Button } from "@/components/ui";
import { diffSummary } from "./diffView";
import { flagsSummary } from "./flagsView";
import { formSummary } from "./formGate";
import { StepTracker } from "./StepTracker";
import { TaskActions } from "./TaskActions";
import { TaskStateBadge } from "./TaskStateBadge";
import { statusSentence, stepLabel } from "./taskPresenter";
import { useGateData, type GateData } from "./useGateData";
import type { Task } from "./types";

interface TaskCardProps {
  task: Task;
  canStart: boolean;
  /** Called after any action on this card settles, so the caller can
   *  refetch immediately instead of waiting for the next poll tick. */
  onSettled: () => void;
  onOpenDetail: (taskId: string) => void;
}

/**
 * One task's live card: name + state badge, a one-line status sentence (or
 * a dedicated error box when `state === "error"`), the step tracker, and
 * exactly the action buttons legal for this state — restyled entirely in
 * this project's own design tokens/UI kit. See taskPresenter.ts and
 * TaskActionBar.tsx for where the actual reference-frontend rules live.
 */
export const TaskCard = memo(function TaskCard({
  task,
  canStart,
  onSettled,
  onOpenDetail,
}: TaskCardProps) {
  const taskId = task.id;
  const openDetail = useCallback(() => onOpenDetail(taskId), [onOpenDetail, taskId]);
  // Data behind a form/flags/diff gate, when the task is waiting at one
  // (always idle for the four older tasks). Action decisions — the legacy
  // incident-review check, the Run form, gate blocks — live in TaskActions.
  const gate = useGateData(task);
  const gateLine = gateSummary(gate);

  return (
    <div className="border-border/60 bg-surface-elevated flex flex-col gap-3 rounded-2xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-ink line-clamp-2 text-[14px] font-semibold">
          {task.displayName}
        </h3>
        <TaskStateBadge state={task.state} className="shrink-0" />
      </div>

      <StepTracker task={task} />

      {task.state === "error" && task.error ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-ink-muted text-[12px]">
            Failed at{" "}
            <strong className="text-ink font-medium">
              {stepLabel(task, task.currentStep)}
            </strong>
          </p>
          <p className="border-border text-ink-muted line-clamp-3 rounded-lg border bg-neutral-50 p-2 font-mono text-[11px]">
            {task.error}
          </p>
        </div>
      ) : (
        <p className="text-ink-muted min-h-[1.25rem] text-[12px]">
          {statusSentence(task)}
        </p>
      )}

      {gateLine && (
        <p className="text-ink -mt-1 text-[12px] font-medium" aria-live="polite">
          {gateLine}
        </p>
      )}

      <div className="mt-1 flex items-end justify-between gap-3">
        <TaskActions
          task={task}
          canStart={canStart}
          onSettled={onSettled}
          onOpenDetail={openDetail}
          gate={gate}
        />
        <Button variant="ghost" size="sm" onClick={openDetail} className="shrink-0">
          Details
        </Button>
      </div>
    </div>
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
