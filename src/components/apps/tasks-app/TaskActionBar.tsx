"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui";
import type { ReviewBlock } from "./approveGate";
import type { TaskActionName } from "./useTaskAction";
import type { TaskState } from "./types";

const DEFAULT_CONFIRM_LABEL = "Confirm & send";

interface TaskActionBarProps {
  state: TaskState;
  pending: TaskActionName | null;
  lastFailure: string | null;
  /** Set when Approve was stopped because incidents still need a
   *  Subcategory2 (see approveGate.ts). */
  reviewBlock?: ReviewBlock | null;
  /** Opens the task's detail view, which lands on the Review tab. */
  onOpenReview?: () => void;
  /** Task-platform gates (all optional; the four older tasks pass none and
   *  render exactly as before). */
  /** Text of the Run button — "Run" unless Run opens a form first. */
  runLabel?: string;
  /** Text of the confirm button at an awaiting_send gate. */
  confirmLabel?: string;
  /** While set, Approve is disabled and this explains why. */
  approveBlocked?: string | null;
  /** While set, the confirm button is disabled and this explains why. */
  sendBlocked?: string | null;
  /** A dedicated-gate call to action (e.g. "Answer questions"). */
  gateAction?: { label: string; onClick: () => void } | null;
  onStart: () => void;
  onApprove: () => void;
  onReject: () => void;
  onSend: () => void;
  onReset: () => void;
}

/**
 * Renders exactly the action buttons legal for `state`: Run
 * only when resting, Retry + Reset only
 * on error, Approve + Reject only in awaiting_review, Confirm & send only
 * in awaiting_send, and a working/finishing task gets no action at all
 * except a Force-reset escape hatch (plus an in-progress indicator in
 * place of a button).
 *
 * Purely presentational: every button only ever calls one of the `on*`
 * callbacks below, never a network function directly — the real calls
 * live in `useTaskAction`. That separation is what makes it possible to
 * verify every button/label/disabled-state combination below by rendering
 * this component directly with hand-written stub callbacks, with no
 * network call anywhere in the render path to accidentally trigger.
 */
export function TaskActionBar({
  state,
  pending,
  lastFailure,
  reviewBlock = null,
  onOpenReview,
  runLabel = "Run",
  confirmLabel = DEFAULT_CONFIRM_LABEL,
  approveBlocked = null,
  sendBlocked = null,
  gateAction = null,
  onStart,
  onApprove,
  onReject,
  onSend,
  onReset,
}: TaskActionBarProps) {
  const isBusy = pending !== null;

  let buttons: ReactNode;
  let caption: ReactNode = null;

  switch (state) {
    case "resting":
      buttons = (
        <Button disabled={isBusy} onClick={onStart}>
          {pending === "start" ? "Starting…" : runLabel}
        </Button>
      );
      break;

    case "error":
      buttons = (
        <>
          <Button disabled={isBusy} onClick={onStart}>
            {pending === "start" ? "Retrying…" : "Retry"}
          </Button>
          <Button variant="outline" disabled={isBusy} onClick={onReset}>
            {pending === "reset" ? "Resetting…" : "Reset"}
          </Button>
        </>
      );
      break;

    case "awaiting_review":
      buttons = (
        <>
          {gateAction && (
            <Button
              variant={approveBlocked ? "solid" : "outline"}
              disabled={isBusy}
              onClick={gateAction.onClick}
            >
              {gateAction.label}
            </Button>
          )}
          <Button
            variant={gateAction && approveBlocked ? "outline" : "solid"}
            disabled={isBusy || Boolean(approveBlocked)}
            onClick={onApprove}
          >
            {pending === "approve" ? "Approving…" : "Approve"}
          </Button>
          <Button variant="outline" disabled={isBusy} onClick={onReject}>
            {pending === "reject" ? "Rejecting…" : "Reject"}
          </Button>
        </>
      );
      if (approveBlocked) {
        caption = <p className="text-ink-muted text-xs">{approveBlocked}</p>;
      }
      if (reviewBlock) {
        const extra = reviewBlock.pending - reviewBlock.numbers.length;
        caption = (
          <p className="text-ink-muted text-xs">
            <strong className="text-ink font-medium">
              {reviewBlock.pending} incident{reviewBlock.pending === 1 ? "" : "s"}
            </strong>{" "}
            still need a Subcategory2
            {reviewBlock.numbers.length > 0 && (
              <>
                {" "}
                (<span className="font-mono">{reviewBlock.numbers.join(", ")}</span>
                {extra > 0 ? ` +${extra} more` : ""})
              </>
            )}
            .{" "}
            {onOpenReview && (
              <button
                type="button"
                onClick={onOpenReview}
                className="text-accent-ink font-semibold underline underline-offset-2"
              >
                Open Review
              </button>
            )}
          </p>
        );
      }
      break;

    case "awaiting_send":
      buttons = (
        <>
          {gateAction && (
            <Button
              variant={sendBlocked ? "solid" : "outline"}
              disabled={isBusy}
              onClick={gateAction.onClick}
            >
              {gateAction.label}
            </Button>
          )}
          <Button
            variant={gateAction && sendBlocked ? "outline" : "solid"}
            disabled={isBusy || Boolean(sendBlocked)}
            onClick={onSend}
          >
            {pending === "send"
              ? confirmLabel === DEFAULT_CONFIRM_LABEL
                ? "Sending…"
                : "Confirming…"
              : confirmLabel}
          </Button>
          {/* A blocked confirm cannot be repaired in place and the engine has no
              reject at this gate: Reset (start over) is the way out. */}
          {sendBlocked && (
            <Button variant="outline" disabled={isBusy} onClick={onReset}>
              {pending === "reset" ? "Resetting…" : "Start over"}
            </Button>
          )}
        </>
      );
      if (sendBlocked) {
        caption = <p className="text-ink-muted text-xs">{sendBlocked}</p>;
      }
      break;

    // "working" and "finishing": no state-machine action is legal — only
    // the Force-reset escape hatch for a hung run.
    default:
      buttons = (
        <>
          <span className="text-ink-muted inline-flex items-center gap-1.5 text-[12.5px] font-semibold">
            <span className="bg-accent motion-safe:animate-blink h-1.5 w-1.5 rounded-full" />
            In progress
          </span>
          <Button
            variant="outline"
            disabled={isBusy}
            onClick={onReset}
            title="Stops the running step and clears the stuck status, so the task can be run again from the start"
          >
            {pending === "reset" ? "Resetting…" : "Force reset"}
          </Button>
        </>
      );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2 [&>button]:shrink-0">
        {buttons}
      </div>
      {caption}
      {lastFailure && <p className="text-red text-xs">{lastFailure}</p>}
    </div>
  );
}
