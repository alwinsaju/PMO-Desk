"use client";

import { memo, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { diffSummary } from "./diffView";
import { flagsSummary } from "./flagsView";
import { formSummary } from "./formGate";
import { StepDots } from "./StepViews";
import { TaskActions } from "./TaskActions";
import { TaskStateBadge } from "./TaskStateBadge";
import { latestArtifactNotification, statusSentence } from "./taskPresenter";
import { OpenFileButtons } from "./OpenFileButtons";
import { explainFailure } from "@/lib/tasks/failureExplainer";
import { plainStepName, stepPosition, timeLeftText } from "@/lib/tasks/runHistory";

import { useGateData, type GateData } from "./useGateData";
import { useTaskRuns } from "./useTaskRuns";
import { WorkflowIcon } from "./WorkflowIcon";
import { lastRunInfo, stepperItems } from "./workflowView";
import type { Task } from "./types";

interface TaskCardProps {
  task: Task;
  /** Called after any action on this card settles, so the caller can
   *  refetch immediately instead of waiting for the next poll tick. */
  onSettled: () => void;
  onOpenDetail: (taskId: string) => void;
  /** Position in the grid — only staggers the entrance animation. */
  index?: number;
  /** The command bar picked this task: ring it and bring it into view. */
  highlighted?: boolean;
}

/**
 * One task's live card: icon, name, last-run line and state badge, a mini
 * timeline of the steps (coloured by status), a one-line status sentence (or,
 * when `state === "error"`, the failure text
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
  highlighted = false,
}: TaskCardProps) {
  const taskId = task.id;
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (highlighted)
      cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlighted]);
  const openDetail = useCallback(() => onOpenDetail(taskId), [onOpenDetail, taskId]);
  // Data behind a form/flags/diff gate, when the task is waiting at one
  // (always idle for the four older tasks). Action decisions — the legacy
  // incident-review check, the Run form, gate blocks — live in TaskActions.
  const gate = useGateData(task);
  const gateLine = gateSummary(gate);
  // Earlier runs: the last-run line, the step colours when idle, and a rough "time left".
  const runs = useTaskRuns(taskId, task.state);
  const timeLeft = timeLeftText(task, runs);
  const lastRun = lastRunInfo(runs, new Date(), task.state);

  return (
    <article
      ref={cardRef}
      data-task-card
      data-highlighted={highlighted || undefined}
      style={{ animationDelay: `${Math.min(index, 8) * 70}ms` }}
      className={cn(
        "spot animate-rise rounded-card border-line bg-card flex min-w-0 flex-col border px-5 pt-5 pb-4",
        highlighted && "ring-focus ring-2",
      )}
    >
      <header className="flex items-center gap-3">
        <WorkflowIcon task={task} />
        <div className="min-w-0 flex-1">
          <h3
            title={task.displayName}
            className="text-ink line-clamp-2 text-[16.5px] leading-tight font-bold tracking-[-0.015em] break-words"
          >
            {task.displayName}
          </h3>
          <p
            data-testid="last-run"
            className="text-ink-muted flex items-center gap-1.5 truncate text-[12px]"
          >
            <i
              aria-hidden
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                lastRun.tone === "success" && "bg-success-dot",
                lastRun.tone === "danger" && "bg-red",
                lastRun.tone === "neutral" && "bg-chip-strong",
              )}
            />
            <span className="truncate">{lastRun.text}</span>
          </p>
        </div>
        <TaskStateBadge state={task.state} className="shrink-0" />
      </header>

      <div className="mt-4 mb-3.5">
        <StepDots items={stepperItems(task)} />
      </div>

      {task.state === "error" && task.error ? (
        <div className="rounded-control bg-red-soft text-red px-3 py-2">
          <p className="text-[12.5px] leading-snug font-semibold">
            {explainFailure(task.error).title}
          </p>
          {/* Only what the task said in plain words; the raw error (with folders) is under Details. */}
          {explainFailure(task.error).message && (
            <p className="line-clamp-2 text-[11.5px] leading-normal [overflow-wrap:anywhere]">
              {explainFailure(task.error).message}
            </p>
          )}
        </div>
      ) : (
        <p className="text-ink-soft line-clamp-2 min-h-5 text-[13.5px]">
          {task.state === "working" || task.state === "finishing"
            ? `${plainStepName(task, task.currentStep)}… (${stepPosition(task) ?? ""}${timeLeft ? `, ${timeLeft}` : ""})`
            : statusSentence(task)}
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
      {task.state === "resting" && latestArtifactNotification(task) && (
        <OpenFileButtons
          taskId={task.id}
          notification={latestArtifactNotification(task)!}
          className="mt-2"
        />
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
