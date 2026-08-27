"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui";
import type { TaskActionName } from "./useTaskAction";
import type { TaskState } from "./types";

interface TaskActionBarProps {
  state: TaskState;
  /** True once at least one pool worker is idle — only gates the "Run"
   *  button (resting state); every other state's buttons don't depend on
   *  worker availability. */
  canStart: boolean;
  pending: TaskActionName | null;
  lastFailure: string | null;
  onStart: () => void;
  onApprove: () => void;
  onReject: () => void;
  onSend: () => void;
  onReset: () => void;
}

/**
 * Renders exactly the action buttons legal for `state` — mirrors
 * agentPresenter.js's `buildActions` switch statement rule for rule: Run
 * only when resting (disabled without an idle worker), Retry + Reset only
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
  canStart,
  pending,
  lastFailure,
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
        <Button size="sm" disabled={!canStart || isBusy} onClick={onStart}>
          {pending === "start" ? "Starting…" : "Run"}
        </Button>
      );
      if (!canStart) {
        caption = (
          <p className="text-ink-faint text-[11px]">
            All agents are busy — try again when one frees up.
          </p>
        );
      }
      break;

    case "error":
      buttons = (
        <>
          <Button size="sm" disabled={isBusy} onClick={onStart}>
            {pending === "start" ? "Retrying…" : "Retry"}
          </Button>
          <Button size="sm" variant="outline" disabled={isBusy} onClick={onReset}>
            {pending === "reset" ? "Resetting…" : "Reset"}
          </Button>
        </>
      );
      break;

    case "awaiting_review":
      buttons = (
        <>
          <Button size="sm" disabled={isBusy} onClick={onApprove}>
            {pending === "approve" ? "Approving…" : "Approve"}
          </Button>
          <Button size="sm" variant="outline" disabled={isBusy} onClick={onReject}>
            {pending === "reject" ? "Rejecting…" : "Reject"}
          </Button>
        </>
      );
      break;

    case "awaiting_send":
      buttons = (
        <Button size="sm" disabled={isBusy} onClick={onSend}>
          {pending === "send" ? "Sending…" : "Confirm & send"}
        </Button>
      );
      break;

    // "working" and "finishing": no state-machine action is legal — only
    // the Force-reset escape hatch for a hung run.
    default:
      buttons = (
        <>
          <span className="text-ink-faint inline-flex items-center gap-1.5 text-[12px]">
            <span className="bg-accent h-1.5 w-1.5 animate-pulse rounded-full" />
            In progress
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={isBusy}
            onClick={onReset}
            title="Clears the stuck status if this has hung — doesn't stop a script that's actually still running"
          >
            {pending === "reset" ? "Resetting…" : "Force reset"}
          </Button>
        </>
      );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">{buttons}</div>
      {caption}
      {lastFailure && <p className="text-ink-faint text-[11px]">{lastFailure}</p>}
    </div>
  );
}
