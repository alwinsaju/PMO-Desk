"use client";

import { Button } from "@/components/ui";
import { StepTracker } from "./StepTracker";
import { TaskActionBar } from "./TaskActionBar";
import { TaskStateBadge } from "./TaskStateBadge";
import { humanize, statusSentence } from "./taskPresenter";
import { useTaskAction } from "./useTaskAction";
import type { Task } from "./types";

interface TaskCardProps {
  task: Task;
  canStart: boolean;
  /** Called after any action on this card settles, so the caller can
   *  refetch immediately instead of waiting for the next poll tick. */
  onSettled: () => void;
  onOpenDetail: () => void;
}

/**
 * One task's live card: name + state badge, a one-line status sentence (or
 * a dedicated error box when `state === "error"`), the step tracker, and
 * exactly the action buttons legal for this state — restyled entirely in
 * this project's own design tokens/UI kit. See taskPresenter.ts and
 * TaskActionBar.tsx for where the actual reference-frontend rules live.
 */
export function TaskCard({ task, canStart, onSettled, onOpenDetail }: TaskCardProps) {
  const action = useTaskAction(task.id, onSettled);

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
            <strong className="text-ink font-medium">{humanize(task.currentStep)}</strong>
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

      <div className="mt-1 flex items-end justify-between gap-3">
        <TaskActionBar
          state={task.state}
          canStart={canStart}
          pending={action.pending}
          lastFailure={action.lastFailure}
          onStart={action.start}
          onApprove={action.approve}
          onReject={action.reject}
          onSend={action.send}
          onReset={action.reset}
        />
        <Button variant="ghost" size="sm" onClick={onOpenDetail} className="shrink-0">
          Details
        </Button>
      </div>
    </div>
  );
}
