// Pure view-model for the sign-off parts of the PMO window: the panel on an
// approval checkpoint, the record form's checks, the evidence choices, the
// stamp display and the badge on a list row. No React, relative imports with the
// .ts extension, so `pnpm test` can load this under plain Node (see
// signoffUi.test.mjs). Nothing here sends anything or decides anything: the
// server enforces every rule, these only say what to show.
import {
  RECORDABLE_OUTCOMES,
  SIGNOFF_OUTCOME_LABEL,
  approverName,
  type RecordableOutcome,
  type SignoffState,
} from "../../../lib/pmo/signoff.ts";
import {
  signoffLine,
  signoffSummary,
  summarizeCheckpoint,
  type SignoffSummary,
} from "../../../lib/pmo/signoffView.ts";
import { DEFAULT_TIME_ZONE, safeTimeZone } from "../../../lib/pmo/time.ts";
import {
  MAX_SIGNOFF_NOTE,
  MAX_SIGNOFF_REASON,
  MAX_SIGNOFF_TEXT,
  type Checkpoint,
  type ReminderPrefs,
  type Todo,
} from "../../../lib/pmo/types.ts";

type ClockPrefs = Pick<ReminderPrefs, "timeZone" | "workDays" | "chaserDays">;

/** "26 Oct 2026, 10:30 IST" for an instant, in the reminder zone (named in full
 *  unless it is the default IST); a bad zone name means IST. */
export function stampTime(iso: string, timeZone?: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const zone = safeTimeZone(timeZone);
  return `${new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: zone,
  }).format(new Date(ms))} ${zone === DEFAULT_TIME_ZONE ? "IST" : zone}`;
}

/** A message link that may be opened: only https (a Teams or Outlook web link).
 *  Anything else is shown as text. */
export function safeHttpsLink(link: string | null | undefined): string | null {
  if (!link) return null;
  try {
    return new URL(link).protocol === "https:" ? link : null;
  } catch {
    return null;
  }
}

export type PanelTone = "neutral" | "accent" | "strong" | "outline";

export interface StampView {
  /** What the record says: "Signed off by", "Approved with conditions by", ... */
  label: string;
  /** The approver the sign-off is from (as named on the to-do); null if none. */
  signedBy: string | null;
  /** The OS user the server recorded, and when (IST). */
  recordedBy: string;
  recordedAt: string;
  evidenceNote: string;
  /** The message in this app that shows it (open it inline), if linked. */
  evidenceIntakeId: string | null;
  /** The message's own link: openable only when it is https. */
  evidenceLink: string | null;
  evidenceLinkText: string | null;
}

export interface PanelAction {
  label: string;
}

export interface SignoffPanelView {
  state: SignoffState;
  headline: string;
  tone: PanelTone;
  approverLine: string;
  /** Who marked the request as sent and when; null before a request. */
  requestedLine: string | null;
  /** Awaiting and past the chase cadence. */
  chase: boolean;
  stamp: StampView | null;
  /** The conditions / changes asked for / reason, with the heading to show. */
  said: { label: string; text: string } | null;
  /** Who confirmed the conditions were met, and when (approved with conditions). */
  confirmedLine: string | null;
  /** One sentence on what happens next. */
  next: string | null;
  /** Earlier answers kept on the checkpoint (revoked or replaced), one line each. */
  previous: string[];
  actions: {
    /** null = no request button; otherwise its label. */
    request: string | null;
    record: boolean;
    confirmConditions: boolean;
    revoke: boolean;
  };
}

const NO_ACTIONS = {
  request: null,
  record: false,
  confirmConditions: false,
  revoke: false,
};

function stampView(summary: SignoffSummary, timeZone?: string): StampView | null {
  const stamp = summary.stamp;
  if (!stamp) return null;
  const link = stamp.evidence.messageLink;
  const label =
    summary.state === "conditions"
      ? "Approved with conditions"
      : summary.state === "changes_requested"
        ? "Changes requested"
        : summary.state === "rejected"
          ? "Rejected"
          : "Signed off";
  return {
    label: summary.approver ? `${label} by` : label,
    signedBy: summary.approver,
    recordedBy: stamp.recordedBy,
    recordedAt: stampTime(stamp.recordedAt, timeZone),
    evidenceNote: stamp.evidence.note,
    evidenceIntakeId: stamp.evidence.intakeId,
    evidenceLink: safeHttpsLink(link),
    evidenceLinkText: link ?? null,
  };
}

const SAID_LABEL: Partial<Record<SignoffState, string>> = {
  conditions: "Conditions",
  approved: "Conditions (confirmed as met)",
  changes_requested: "Changes asked for",
  rejected: "Reason given",
};

/** What the panel on an approval checkpoint shows and offers. `open` is whether
 *  the to-do is still open (a closed one shows its state and offers nothing). */
export function signoffPanelView(
  todo: Pick<Todo, "chaserDays">,
  checkpoint: Checkpoint,
  now: Date,
  prefs: ClockPrefs,
  open: boolean,
): SignoffPanelView {
  const summary = summarizeCheckpoint(checkpoint, todo, now, prefs);
  const who = summary.approver;
  const by = who ? ` by ${who}` : "";
  const from = who ? ` from ${who}` : "";
  const base = {
    state: summary.state,
    approverLine: who ? `Approver: ${who}` : "Approver: not named yet",
    requestedLine: summary.requestedAt
      ? `Marked as sent ${stampTime(summary.requestedAt, prefs.timeZone)}${summary.requestedBy ? ` by ${summary.requestedBy}` : ""}. Nothing was sent by this app.`
      : null,
    chase: summary.overdue,
    confirmedLine: summary.conditionsConfirmedAt
      ? `Conditions confirmed as met${summary.conditionsConfirmedBy ? ` by ${summary.conditionsConfirmedBy}` : ""}, ${stampTime(summary.conditionsConfirmedAt, prefs.timeZone)}.`
      : null,
    stamp: stampView(summary, prefs.timeZone),
    said:
      summary.conditions && SAID_LABEL[summary.state]
        ? { label: SAID_LABEL[summary.state]!, text: summary.conditions }
        : null,
    previous: previousLines(checkpoint, prefs.timeZone),
  };
  const act = (actions: Partial<SignoffPanelView["actions"]>) =>
    open ? { ...NO_ACTIONS, ...actions } : NO_ACTIONS;

  switch (summary.state) {
    case "not_requested":
      return {
        ...base,
        headline: "Sign-off not requested yet",
        tone: "neutral",
        next: "Prepare the request, send it yourself, then mark it as requested.",
        actions: act({ request: "Request sign-off", record: true }),
      };
    case "awaiting":
      return {
        ...base,
        headline: signoffLine(summary),
        tone: summary.overdue ? "strong" : "accent",
        next: summary.overdue
          ? "Past the chase cadence: time to follow up with the approver."
          : "Record the answer when it arrives, or accept it from the Review Queue if it comes in the same conversation.",
        actions: act({ request: "Request again", record: true }),
      };
    case "conditions":
      return {
        ...base,
        headline: `Approved with conditions${by}`,
        tone: "accent",
        next: "The step stays open until you confirm the conditions are met.",
        actions: act({ confirmConditions: true, revoke: true }),
      };
    case "changes_requested":
      return {
        ...base,
        headline: `Changes requested${by}`,
        tone: "strong",
        next: "The Draft step is reopened. Make the changes, then request sign-off again.",
        actions: act({ request: "Request sign-off again", record: true, revoke: true }),
      };
    case "rejected":
      return {
        ...base,
        headline: `Rejected${by}`,
        tone: "strong",
        next: "The Draft step is reopened. Rework it and request sign-off again, or revoke this record if it was a mistake.",
        actions: act({ request: "Request sign-off again", record: true, revoke: true }),
      };
    case "approved":
      return {
        ...base,
        headline: `Signed off${by}`,
        tone: "outline",
        next: null,
        actions: act({ revoke: true }),
      };
    case "skipped":
      return {
        ...base,
        headline: "Sign-off skipped",
        tone: "neutral",
        next: "Reopen the step if a sign-off is needed after all.",
        actions: NO_ACTIONS,
      };
    case "legacy_done":
      return {
        ...base,
        headline: "Marked done without a sign-off record",
        tone: "neutral",
        next: `Ticked as done before sign-offs were tracked${from ? ` (approver${from})` : ""}. Reopen it to record a sign-off.`,
        actions: NO_ACTIONS,
      };
  }
}

function previousLines(checkpoint: Checkpoint, timeZone?: string): string[] {
  return (checkpoint.signoff?.previous ?? []).map((entry) => {
    const outcome = SIGNOFF_OUTCOME_LABEL[entry.outcome].toLowerCase();
    const recorded = entry.stamp
      ? `${outcome}, recorded by ${entry.stamp.recordedBy} ${stampTime(entry.stamp.recordedAt, timeZone)}`
      : outcome;
    const ended =
      entry.ended.kind === "revoked"
        ? `revoked by ${entry.ended.by} ${stampTime(entry.ended.at, timeZone)}${entry.ended.reason ? `: ${entry.ended.reason}` : ""}`
        : `replaced by a new request ${stampTime(entry.ended.at, timeZone)}`;
    return `${recorded[0].toUpperCase()}${recorded.slice(1)}; ${ended}.`;
  });
}

// --- the record form ----------------------------------------------------------------

export const OUTCOME_CHOICES: { value: RecordableOutcome; label: string }[] =
  RECORDABLE_OUTCOMES.map((value) => ({
    value,
    label:
      value === "approved_with_conditions"
        ? "With conditions"
        : SIGNOFF_OUTCOME_LABEL[value],
  }));

export interface RecordForm {
  outcome: RecordableOutcome;
  conditions: string;
  note: string;
  /** "" = no linked message. */
  intakeId: string;
}

export const emptyRecordForm = (): RecordForm => ({
  outcome: "approved",
  conditions: "",
  note: "",
  intakeId: "",
});

/** The heading of the free-text field for an outcome, and whether it is needed. */
export function conditionsField(outcome: RecordableOutcome): {
  label: string;
  required: boolean;
  shown: boolean;
} {
  switch (outcome) {
    case "approved_with_conditions":
      return { label: "Conditions", required: true, shown: true };
    case "changes_requested":
      return { label: "Changes asked for", required: true, shown: true };
    case "rejected":
      return { label: "Reason (optional)", required: false, shown: true };
    default:
      return { label: "", required: false, shown: false };
  }
}

/** Why the form cannot be submitted yet (the server checks the same rules), or null. */
export function recordFormProblem(form: RecordForm): string | null {
  const field = conditionsField(form.outcome);
  if (!form.note.trim() && !form.intakeId) {
    return "Say where the sign-off came from (for example: email from Priya, 26 Oct).";
  }
  if (form.note.length > MAX_SIGNOFF_NOTE) return "That note is too long.";
  if (field.shown && field.required && !form.conditions.trim()) {
    return form.outcome === "changes_requested"
      ? "Write down the changes that were asked for."
      : "Write down the conditions.";
  }
  if (form.conditions.length > MAX_SIGNOFF_TEXT) return "That text is too long.";
  return null;
}

export const MAX_REVOKE_REASON = MAX_SIGNOFF_REASON;
export const revokeProblem = (reason: string): string | null =>
  reason.trim().length < 3
    ? "Give a reason."
    : reason.length > MAX_REVOKE_REASON
      ? "That reason is too long."
      : null;

/** The messages of this to-do a sign-off can point at: its source and the
 *  messages linked into its timeline (the server accepts only these). */
export function evidenceOptions(
  todo: Pick<Todo, "source" | "history">,
  timeZone?: string,
): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [
    { value: "", label: "No linked message" },
  ];
  const seen = new Set<string>();
  if (todo.source.intakeId) {
    seen.add(todo.source.intakeId);
    options.push({
      value: todo.source.intakeId,
      label: `Original message${todo.source.sender ? ` from ${todo.source.sender}` : ""}`,
    });
  }
  for (const entry of [...(todo.history ?? [])].reverse()) {
    if (!entry.intakeId || seen.has(entry.intakeId)) continue;
    seen.add(entry.intakeId);
    options.push({
      value: entry.intakeId,
      label: `Message${entry.from ? ` from ${entry.from}` : ""}, ${stampTime(entry.at, timeZone).replace(/, \d{2}:\d{2} [^,]+$/, "")}`,
    });
  }
  return options;
}

// --- the request dialog -----------------------------------------------------------------

/** Quick picks for the approver: the requester and the sender of the source
 *  message, as "Name (address)" when both are known. */
export function approverSuggestions(
  todo: Pick<Todo, "requester" | "source">,
  current: string,
): string[] {
  const out: string[] = [];
  const requester = [todo.requester.name?.trim(), todo.requester.email?.trim()];
  if (requester[0] && requester[1]) out.push(`${requester[0]} (${requester[1]})`);
  else if (requester[0] || requester[1]) out.push((requester[0] || requester[1])!);
  const sender = todo.source.sender?.trim();
  if (sender) out.push(sender);
  return out.filter(
    (value, index, all) =>
      all.indexOf(value) === index &&
      value.toLowerCase() !== current.trim().toLowerCase(),
  );
}

// --- the list row ---------------------------------------------------------------------------

export interface SignoffRowView {
  /** "Awaiting sign-off from Priya Nair for 3 days" etc. */
  text: string;
  tone: PanelTone;
  /** Awaiting and past the chase cadence. */
  overdue: boolean;
  state: SignoffState;
}

/** The sign-off line on a to-do row, only while something is open: a request
 *  unanswered, conditions to confirm, or the work sent back. null otherwise. */
export function signoffRowView(
  todo: Pick<Todo, "checkpoints" | "chaserDays" | "status">,
  now: Date,
  prefs: ClockPrefs,
): SignoffRowView | null {
  if (todo.status !== "open") return null;
  const summary = signoffSummary(todo, now, prefs);
  if (!summary) return null;
  switch (summary.state) {
    case "awaiting":
      return {
        text: signoffLine(summary),
        // Never "strong": a row has at most one strong chip (overdue, beside the title).
        tone: "accent",
        overdue: summary.overdue,
        state: summary.state,
      };
    case "conditions":
    case "changes_requested":
    case "rejected":
      return {
        text: signoffLine(summary),
        tone: summary.state === "conditions" ? "accent" : "outline",
        overdue: false,
        state: summary.state,
      };
    default:
      return null;
  }
}

/** Short text for the badge beside the sign-off line. */
export function signoffBadgeText(view: SignoffRowView): string {
  switch (view.state) {
    case "awaiting":
      return view.overdue ? "Sign-off overdue" : "Sign-off pending";
    case "conditions":
      return "Conditions";
    case "changes_requested":
      return "Changes requested";
    case "rejected":
      return "Rejected";
    default:
      return "";
  }
}

export { approverName };
