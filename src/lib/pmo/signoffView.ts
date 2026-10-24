// What the rest of the app shows about a to-do's sign-off: one summary per to-do,
// computed the same way for the list row, the detail dialog, the weekly report
// and the tests. Pure (no clock of its own: the caller passes `now`), and kept
// apart from signoff.ts because it needs the working-day maths in due.ts, which
// itself imports signoff.ts for the reminder wording.
import { chaserDaysFor, localParts, workingDaysBetween } from "./due.ts";
import {
  SIGNOFF_STATE_LABEL,
  approvalCheckpoints,
  approverName,
  signoffOf,
  signoffState,
  type SignoffState,
} from "./signoff.ts";
import type {
  Checkpoint,
  ReminderPrefs,
  SignoffOutcome,
  SignoffStamp,
  Todo,
} from "./types.ts";

export interface SignoffSummary {
  checkpointId: string;
  /** The checkpoint's own label ("Sign-off received"). */
  checkpointLabel: string;
  state: SignoffState;
  stateLabel: string;
  /** The approver's name (else address); null when none is named. */
  approver: string | null;
  /** The approver text as typed (name and/or address). */
  approverRaw: string | null;
  outcome: SignoffOutcome;
  conditions: string;
  stamp: SignoffStamp | null;
  /** "Approved with conditions" only: who confirmed they were met, and when. */
  conditionsConfirmedAt: string | null;
  conditionsConfirmedBy: string | null;
  requestedAt: string | null;
  requestedBy: string | null;
  /** Awaiting only: the day it was marked as sent (in the prefs' zone) and how
   *  long ago, in calendar and working days. */
  sinceDay: string | null;
  calendarDays: number | null;
  quietDays: number | null;
  /** Awaiting and past the chase cadence: time to chase the approver. */
  overdue: boolean;
  /** Earlier answers kept on the checkpoint (revoked or replaced). */
  previousCount: number;
}

const DAY_MS = 86_400_000;

/** Which approval checkpoint speaks for the to-do: the first one that still needs
 *  something (not signed off, not skipped, not ticked before phase 6), else the
 *  last one, so a finished to-do still shows who signed it off. */
export function mainApproval(todo: Pick<Todo, "checkpoints">) {
  const all = approvalCheckpoints(todo);
  if (all.length === 0) return null;
  const open = all.find((c) => {
    const state = signoffState(c);
    return state !== "approved" && state !== "skipped" && state !== "legacy_done";
  });
  return open ?? all[all.length - 1];
}

/** The summary of one approval checkpoint. */
export function summarizeCheckpoint(
  checkpoint: Checkpoint,
  todo: Pick<Todo, "chaserDays">,
  now: Date,
  prefs: Pick<ReminderPrefs, "timeZone" | "workDays" | "chaserDays">,
): SignoffSummary {
  const state = signoffState(checkpoint);
  const signoff = signoffOf(checkpoint);
  let sinceDay: string | null = null;
  let calendarDays: number | null = null;
  let quietDays: number | null = null;
  let overdue = false;
  if (
    state === "awaiting" &&
    signoff.requestedAt &&
    !Number.isNaN(Date.parse(signoff.requestedAt))
  ) {
    sinceDay = localParts(signoff.requestedAt, prefs.timeZone).day;
    const today = localParts(now, prefs.timeZone).day;
    quietDays = workingDaysBetween(sinceDay, today, prefs);
    calendarDays = Math.max(
      0,
      Math.round(
        (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${sinceDay}T00:00:00Z`)) / DAY_MS,
      ),
    );
    overdue = quietDays >= chaserDaysFor(todo, prefs);
  }
  return {
    checkpointId: checkpoint.id,
    checkpointLabel: checkpoint.label,
    state,
    stateLabel: SIGNOFF_STATE_LABEL[state],
    approver: approverName(signoff.approver),
    approverRaw: signoff.approver,
    outcome: signoff.outcome,
    conditions: signoff.conditions,
    stamp: signoff.stamp,
    conditionsConfirmedAt: signoff.conditionsConfirmedAt,
    conditionsConfirmedBy: signoff.conditionsConfirmedBy,
    requestedAt: signoff.requestedAt,
    requestedBy: signoff.requestedBy,
    sinceDay,
    calendarDays,
    quietDays,
    overdue,
    previousCount: signoff.previous.length,
  };
}

/** The summary that speaks for the to-do; null when it has no sign-off step. */
export function signoffSummary(
  todo: Pick<Todo, "checkpoints" | "chaserDays">,
  now: Date,
  prefs: Pick<ReminderPrefs, "timeZone" | "workDays" | "chaserDays">,
): SignoffSummary | null {
  const checkpoint = mainApproval(todo);
  return checkpoint ? summarizeCheckpoint(checkpoint, todo, now, prefs) : null;
}

/** Does this summary belong in "Needs a decision" / on a badge? The sign-off is
 *  open: requested and unanswered, answered with conditions, or sent back. */
export const signoffNeedsAttention = (summary: SignoffSummary | null): boolean =>
  !!summary &&
  (summary.state === "awaiting" ||
    summary.state === "conditions" ||
    summary.state === "changes_requested" ||
    summary.state === "rejected");

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "Awaiting sign-off from Priya Nair for 3 days" and its relatives, in plain
 *  words (no Markdown, no user text beyond the approver's name). */
export function signoffLine(summary: SignoffSummary): string {
  const who = summary.approver ? ` from ${summary.approver}` : "";
  switch (summary.state) {
    case "awaiting": {
      const age =
        summary.calendarDays === null
          ? ""
          : summary.calendarDays === 0
            ? " since today"
            : ` for ${plural(summary.calendarDays, "day")}`;
      return `Awaiting sign-off${who}${age}`;
    }
    case "conditions":
      return `Approved with conditions${who}: conditions to confirm`;
    case "changes_requested":
      return `Changes requested${who}`;
    case "rejected":
      return `Rejected${who}`;
    case "approved":
      return `Signed off${who}`;
    default:
      return summary.stateLabel;
  }
}
