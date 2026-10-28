/**
 * Wording for the confirm dialog in front of the one-click Confirm & send,
 * Reject and Force reset actions (QA SEC-8). Pure: no React, no network.
 */
import {
  latestReviewNotification,
  notificationFiles,
  pausedStep,
} from "./taskPresenter.ts";
import type { Task } from "./types";

export type ConfirmAction = "send" | "reject" | "reset";

export interface ConfirmCopy {
  title: string;
  body: string;
  /** Extra facts echoed above the body (task, notice, files). */
  details: string[];
  confirmLabel: string;
  /** True when the action can't be undone / discards work (red button). */
  destructive: boolean;
  /** True when the dialog should echo the Outlook draft's recipients and subject. */
  showsDraft: boolean;
}

export const SEND_NOTE =
  "The email will be sent from your Outlook now. This cannot be undone.";
export const REJECT_NOTE =
  "The draft stays in your Outlook Drafts folder; delete it there if you do not need it.";
export const RESET_NOTE =
  "This stops the run now. Anything already created (such as an Outlook draft) stays.";

const DEFAULT_SEND_LABEL = "Confirm & send";
const MAIL_PATTERN = /mail|outlook/i;

/** True when the task sends mail: its id, name, steps or notices say so. */
export function isMailTask(task: Task): boolean {
  const haystack = [
    task.id,
    task.displayName,
    ...task.steps.flatMap((s) => [s.id, s.label ?? ""]),
    ...task.notifications.flatMap((n) => [n.title, n.body]),
  ];
  return haystack.some((text) => MAIL_PATTERN.test(text ?? ""));
}

/** Last path segment of a Windows or POSIX path. */
export function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Force reset only needs a confirm while a run is in progress. */
export function needsConfirm(action: ConfirmAction, task: Task): boolean {
  return action !== "reset" || task.state === "working" || task.state === "finishing";
}

/** The dialog text for `action`, or null when no confirmation is needed. */
export function confirmCopy(action: ConfirmAction, task: Task): ConfirmCopy | null {
  if (!needsConfirm(action, task)) return null;

  if (action === "reset") {
    return {
      title: `Force reset ${task.displayName}?`,
      body: RESET_NOTE,
      details: [],
      confirmLabel: "Force reset",
      destructive: true,
      showsDraft: false,
    };
  }

  if (action === "reject") {
    const mail = isMailTask(task);
    return {
      title: `Reject this draft of ${task.displayName}?`,
      body: mail
        ? REJECT_NOTE
        : "The task goes back to idle and this draft is discarded.",
      details: [],
      confirmLabel: "Reject",
      destructive: true,
      showsDraft: false,
    };
  }

  const mail = isMailTask(task);
  const stepLabel = pausedStep(task)?.label?.trim();
  const confirmLabel = stepLabel || DEFAULT_SEND_LABEL;
  const details: string[] = [`Task: ${task.displayName}`];
  const notice = latestReviewNotification(task);
  const text = notice?.body?.trim() || notice?.title?.trim();
  if (text) details.push(text);
  if (notice) {
    const names = notificationFiles(notice).map((f) => fileName(f.path));
    if (names.length > 0) details.push(`Output: ${names.join(", ")}`);
  }
  return {
    title: mail ? `Send ${task.displayName}?` : `${confirmLabel}?`,
    body: mail ? SEND_NOTE : "This cannot be undone.",
    details,
    confirmLabel,
    destructive: true,
    showsDraft: mail,
  };
}
