"use client";

import { useEffect, useState } from "react";
import { toast } from "@/lib/notifications/toastStore";
import { enqueue, type QueuedSend } from "@/lib/tasks/sendQueue";
import { retryLabel } from "@/lib/tasks/failureExplainer";
import { plainStepName } from "@/lib/tasks/runHistory";
import { useTasksPrefs } from "@/lib/tasks/tasksPrefsStore";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { confirmCopy, needsConfirm, type ConfirmAction } from "./confirmCopy";
import { blockingSummary } from "./diffView";
import { StartTaskDialog } from "./StartTaskDialog";
import { TaskActionBar } from "./TaskActionBar";
import { gateActionLabel, hasStartForm, pausedStep } from "./taskPresenter";
import { isFreshRunRequest, useTasksNav } from "./tasksNavStore";
import { useTaskAction } from "./useTaskAction";
import type { GateData } from "./useGateData";
import type { Task } from "./types";

interface TaskActionsProps {
  task: Task;
  /** Called after any action on this task settles, so the caller can
   *  refetch immediately instead of waiting for the next poll tick. */
  onSettled: () => void;
  /** Opens the task's detail view (the Review tab). Omit when already in it. */
  onOpenDetail?: () => void;
  /** Data behind the gate the task is paused at (see useGateData). */
  gate: GateData;
  /** Extra reasons Approve/confirm must wait, from the surrounding view
   *  (e.g. answers staged but not saved yet). */
  extraBlock?: { approve?: string | null; send?: string | null };
}

/**
 * The action buttons for one task plus everything that decides them: the
 * state-machine hook, the legacy incident-review Approve check, the Run form
 * for tasks with inputs, and the gate-specific blocks (unanswered questions,
 * blocking diff items). Used by the task card and, while a gate is open, by
 * the detail dialog's footer, so both always agree on what is allowed.
 */
export function TaskActions({
  task,
  onSettled,
  onOpenDetail,
  gate,
  extraBlock,
}: TaskActionsProps) {
  // Approve at the incident-review gate re-checks the live queue first.
  const atReviewGate =
    task.state === "awaiting_review" && task.currentStep === "review_incidents";
  const action = useTaskAction(task.id, onSettled, atReviewGate);
  const [formOpen, setFormOpen] = useState(false);
  const [confirming, setConfirming] = useState<ConfirmAction | null>(null);
  const pendingCopy = confirming ? confirmCopy(confirming, task) : null;

  // Send, Reject and Force reset (mid-run) ask first; the rest go straight through.
  const ask = (kind: ConfirmAction, go: () => void) => () =>
    needsConfirm(kind, task) ? setConfirming(kind) : go();
  const runConfirmed = () => {
    const kind = confirming;
    setConfirming(null);
    if (kind === "send") action.send();
    else if (kind === "reject") action.reject();
    else if (kind === "reset") action.reset();
  };

  // A "N still need a Subcategory2" notice describes the queue as of the
  // last Approve click; once the task leaves the gate it's no longer true.
  const { clearReviewBlock } = action;
  useEffect(() => {
    if (!atReviewGate) clearReviewBlock();
  }, [atReviewGate, clearReviewBlock]);

  // Run opens the input form for tasks that declare inputs; Retry (error
  // state) reuses the inputs already uploaded and starts straight away.
  const runOpensForm = task.state === "resting" && hasStartForm(task);

  // The command bar asked for this task's Run form ("prepare this week's aging report").
  const runRequest = useTasksNav((s) => s.runRequest);
  const clearRunRequest = useTasksNav((s) => s.clearRunRequest);
  useEffect(() => {
    if (!runRequest || runRequest.taskId !== task.id) return;
    if (runOpensForm && isFreshRunRequest(runRequest)) setFormOpen(true);
    clearRunRequest(runRequest.id);
  }, [runRequest, task.id, runOpensForm, clearRunRequest]);

  let approveBlocked: string | null = null;
  let sendBlocked: string | null = null;
  if (gate.gate === "form" && gate.form && gate.form.pending.length > 0) {
    const n = gate.form.pending.length;
    approveBlocked = `Answer and save the ${n} open question${n === 1 ? "" : "s"} to approve.`;
  }
  if (gate.gate === "diff" && gate.diff?.blocking && gate.diff.blocking.length > 0) {
    sendBlocked = `Blocked: ${blockingSummary(gate.diff.blocking)}`;
  }
  // The engine also refuses a confirm when the diff file is missing or
  // malformed, so don't offer it without a readable diff.
  if (gate.gate === "diff" && gate.status !== "loading" && !gate.diff) {
    sendBlocked = "The comparison isn’t available yet, so there is nothing to confirm.";
  }
  approveBlocked = approveBlocked ?? extraBlock?.approve ?? null;
  sendBlocked = sendBlocked ?? extraBlock?.send ?? null;

  const step = pausedStep(task);
  const gateAction =
    onOpenDetail && gate.gate
      ? { label: gateActionLabel(gate.gate), onClick: onOpenDetail }
      : null;

  return (
    <>
      <TaskActionBar
        state={task.state}
        pending={action.pending}
        lastFailure={action.lastFailure}
        reviewBlock={action.reviewBlock}
        runLabel={runOpensForm ? "Run…" : "Run"}
        retryLabel={retryLabel(
          task.currentStep ? plainStepName(task, task.currentStep) : null,
        )}
        confirmLabel={step?.label || undefined}
        approveBlocked={approveBlocked}
        sendBlocked={sendBlocked}
        gateAction={gateAction}
        onOpenReview={() => {
          action.clearReviewBlock();
          onOpenDetail?.();
        }}
        onStart={runOpensForm ? () => setFormOpen(true) : () => void action.start()}
        onApprove={action.approve}
        onReject={ask("reject", action.reject)}
        onSend={ask("send", action.send)}
        onReset={ask("reset", action.reset)}
      />
      <ConfirmActionDialog
        copy={pendingCopy}
        taskId={task.id}
        onConfirm={runConfirmed}
        onCancel={() => setConfirming(null)}
        onQueue={(at, summary) => {
          setConfirming(null);
          const item: QueuedSend = {
            id: `q${Date.now().toString(36)}`,
            taskId: task.id,
            taskName: task.displayName,
            at: at.toISOString(),
            queuedAt: new Date().toISOString(),
            subject: summary.subject,
            recipients: { to: summary.to, cc: summary.cc },
          };
          useTasksPrefs.getState().update((t) => ({
            ...t,
            queue: enqueue(t.queue, item),
            recipients: { ...t.recipients, [task.id]: item.recipients },
          }));
          toast({
            tone: "success",
            message: `Queued: ${task.displayName} will be sent ${at.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })} if PMO Desk is open.`,
          });
        }}
      />
      {hasStartForm(task) && (
        <StartTaskDialog
          task={task}
          open={formOpen}
          onOpenChange={setFormOpen}
          onStart={action.start}
        />
      )}
    </>
  );
}
