// Sign-off tracking for approval-kind checkpoints (phase 6): the state machine,
// the refusals, the request bodies, and the guards around the model's reading of
// a reply. Pure (no clock, no files, no node imports): the caller passes `now`
// and `by`, and on the server those come from the server's clock and the OS user,
// never from a request. THIS APP NEVER SENDS A SIGN-OFF REQUEST: "request sign-off"
// only prepares text, and the person marks it as sent themselves.
//
// States of an approval checkpoint (`signoffState`):
//   not_requested   nothing sent yet
//   awaiting        request marked as sent, no answer recorded
//   conditions      approved with conditions; the step stays open until a person
//                   confirms the conditions are met
//   changes_requested / rejected   an answer is on record, the Draft (and
//                   "Sent for sign-off") steps are reopened
//   approved        done, with an immutable stamp
//   skipped         a person decided no sign-off is needed
//   legacy_done     ticked done before phase 6 (no stamp to show)
//
// The stamp {recordedBy, recordedAt, evidence} is written once and never edited.
// `revokeSignoff` is the only undo: it needs a reason and moves the stamp,
// unchanged, into `previous`.
import { z } from "zod";
import { groundQuote } from "./quote.ts";
import { appendHistory, historyEntry, type TodoPatch } from "./todoLogic.ts";
import {
  MAX_SIGNOFF_APPROVER,
  MAX_SIGNOFF_NOTE,
  MAX_SIGNOFF_PREVIOUS,
  MAX_SIGNOFF_REASON,
  MAX_SIGNOFF_TEXT,
  SIGNOFF_CLASSES,
  SignoffSchema,
  type AiUpdate,
  type Checkpoint,
  type HistoryEntry,
  type Signoff,
  type SignoffClass,
  type SignoffOutcome,
  type Todo,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Reading a checkpoint's sign-off
// ---------------------------------------------------------------------------

export const emptySignoff = (): Signoff => SignoffSchema.parse({});

/** The checkpoint's sign-off, or an empty one for a record from before phase 6. */
export const signoffOf = (checkpoint: Checkpoint): Signoff =>
  checkpoint.signoff ?? emptySignoff();

export const isApproval = (checkpoint: Checkpoint): boolean =>
  checkpoint.kind === "approval";

export type SignoffState =
  | "not_requested"
  | "awaiting"
  | "conditions"
  | "changes_requested"
  | "rejected"
  | "approved"
  | "skipped"
  | "legacy_done";

export function signoffState(checkpoint: Checkpoint): SignoffState {
  if (checkpoint.state === "skipped") return "skipped";
  const signoff = signoffOf(checkpoint);
  if (signoff.stamp) {
    switch (signoff.outcome) {
      case "approved":
        return "approved";
      case "approved_with_conditions":
        return signoff.conditionsConfirmedAt ? "approved" : "conditions";
      case "changes_requested":
        return "changes_requested";
      case "rejected":
        return "rejected";
      default:
        break;
    }
  }
  if (checkpoint.state === "done") return "legacy_done";
  return signoff.requestedAt ? "awaiting" : "not_requested";
}

export const SIGNOFF_STATE_LABEL: Record<SignoffState, string> = {
  not_requested: "Sign-off not requested yet",
  awaiting: "Awaiting sign-off",
  conditions: "Approved with conditions",
  changes_requested: "Changes requested",
  rejected: "Rejected",
  approved: "Signed off",
  skipped: "Sign-off skipped",
  legacy_done: "Marked done",
};

export const SIGNOFF_OUTCOME_LABEL: Record<SignoffOutcome, string> = {
  pending: "Pending",
  approved: "Approved",
  approved_with_conditions: "Approved with conditions",
  changes_requested: "Changes requested",
  rejected: "Rejected",
};

/** The outcomes a person (or a reply) can record. */
export const RECORDABLE_OUTCOMES = [
  "approved",
  "approved_with_conditions",
  "changes_requested",
  "rejected",
] as const;
export type RecordableOutcome = (typeof RECORDABLE_OUTCOMES)[number];

export const approvalCheckpoints = (todo: Pick<Todo, "checkpoints">): Checkpoint[] =>
  todo.checkpoints.filter(isApproval);

/** The first approval checkpoint that is still pending with a request marked as
 *  sent and no answer: the one a reply would answer. Open to-dos only. */
export function awaitingSignoff(
  todo: Pick<Todo, "checkpoints" | "status">,
): { checkpoint: Checkpoint; signoff: Signoff; approver: string | null } | null {
  if (todo.status !== "open") return null;
  for (const checkpoint of todo.checkpoints) {
    if (!isApproval(checkpoint) || checkpoint.state !== "pending") continue;
    const signoff = signoffOf(checkpoint);
    if (signoff.requestedAt && signoff.outcome === "pending" && !signoff.stamp) {
      return { checkpoint, signoff, approver: signoff.approver?.trim() || null };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The approver: a name, an address, or both in one text
// ---------------------------------------------------------------------------

const EMAIL_ONE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const EMAIL_ALL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const norm = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

export function approverEmail(approver: string | null | undefined): string | null {
  const found = EMAIL_ONE.exec(approver ?? "");
  return found ? found[0].toLowerCase() : null;
}

/** What to call the approver: the text without the address, or the address when
 *  that is all there is. null when empty. */
export function approverName(approver: string | null | undefined): string | null {
  const text = (approver ?? "").trim();
  if (!text) return null;
  const bare = text
    .replace(EMAIL_ALL, " ")
    .replace(/[<>()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return bare || text;
}

const NAME_STOP = new Set(["the", "and", "of", "mr", "mrs", "ms", "dr", "team"]);
const nameTokens = (text: string | null | undefined): string[] =>
  (text ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !NAME_STOP.has(token));

/**
 * Is this sender the named approver? Stricter than thread.looksLikeReplyFrom,
 * because a yes here is what lets a reply pre-tick "mark received":
 *  - when the approver text holds an address, only that exact address matches;
 *  - otherwise the sender's name must equal the approver's name (ignoring case,
 *    accents and order), or contain every word of a name of two or more words
 *    ("Priya Nair" matches "Priya Nair (Finance)", not "Priya Menon");
 *  - a one-word approver ("Priya") matches only a sender called exactly that.
 */
export function senderIsApprover(
  approver: string | null | undefined,
  sender: { name?: string | null; address?: string | null },
): boolean {
  const text = (approver ?? "").trim();
  if (!text) return false;
  const email = approverEmail(text);
  if (email) return norm(sender.address) === email;
  const wanted = [...new Set(nameTokens(text))];
  if (wanted.length === 0) return false;
  const fromName = new Set(nameTokens(sender.name));
  const fromAddress = new Set(nameTokens(norm(sender.address).split("@")[0]));
  const equal = (have: Set<string>) =>
    have.size === wanted.length && wanted.every((token) => have.has(token));
  const contains = (have: Set<string>) =>
    wanted.length >= 2 && wanted.every((token) => have.has(token));
  return (
    equal(fromName) || contains(fromName) || (wanted.length >= 2 && contains(fromAddress))
  );
}

// ---------------------------------------------------------------------------
// Request bodies (what a client may send). Server-owned fields are refused.
// ---------------------------------------------------------------------------

/** Fields only the server may set. A client that sends one gets a refusal, not
 *  a silent ignore, so a forged identity or time is visible as an attempt. */
export const SERVER_OWNED_SIGNOFF_KEYS = [
  "recordedBy",
  "recordedAt",
  "requestedBy",
  "requestedAt",
  "conditionsConfirmedBy",
  "conditionsConfirmedAt",
  "revokedBy",
  "revokedAt",
  "stamp",
  "signoff",
  "outcome",
  "evidence",
  "by",
  "at",
  "user",
] as const;

export const SERVER_OWNED_MESSAGE =
  "Who recorded a sign-off and when are set by the server and cannot be sent.";

const hasOwn = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

function ownedKeysIn(value: unknown, allowed: readonly string[]): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return SERVER_OWNED_SIGNOFF_KEYS.filter(
    (key) => !allowed.includes(key) && hasOwn(value, key),
  );
}

/** For a sign-off action's body: the server-owned keys it contains (`allowed`
 *  lists the ones that action legitimately takes, e.g. `outcome` on record). */
export const serverOwnedKeysIn = ownedKeysIn;

/** For the generic PATCH body: any sign-off field, at the top level or inside a
 *  checkpoint entry. The PATCH route can neither write nor fake a sign-off. */
export function signoffKeysInPatchBody(body: unknown): string[] {
  const found = new Set<string>(ownedKeysIn(body, []));
  if (body && typeof body === "object" && !Array.isArray(body)) {
    for (const list of ["checkpoints", "addCheckpoints", "renameCheckpoints"]) {
      const entries = (body as Record<string, unknown>)[list];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries)
        for (const key of ownedKeysIn(entry, [])) found.add(key);
    }
  }
  return [...found];
}

const checkpointId = z.string().min(1).max(60).optional();

export const SignoffRequestBodySchema = z.strictObject({
  checkpointId,
  /** Who must sign off; omitted keeps the one already on the checkpoint. */
  approver: z.string().trim().max(MAX_SIGNOFF_APPROVER).nullable().optional(),
});
export type SignoffRequestBody = z.infer<typeof SignoffRequestBodySchema>;

export const SignoffRecordBodySchema = z.strictObject({
  checkpointId,
  outcome: z.enum(RECORDABLE_OUTCOMES),
  /** The conditions, or the changes asked for. */
  conditions: z.string().trim().max(MAX_SIGNOFF_TEXT).optional(),
  /** Where the sign-off came from, in the person's words. */
  note: z.string().trim().max(MAX_SIGNOFF_NOTE).optional(),
  /** A message of this to-do that shows it (checked by the server). */
  intakeId: z.string().min(1).max(80).nullable().optional(),
});
export type SignoffRecordBody = z.infer<typeof SignoffRecordBodySchema>;

export const SignoffConfirmBodySchema = z.strictObject({ checkpointId });

export const SignoffRevokeBodySchema = z.strictObject({
  checkpointId,
  reason: z.string().trim().min(3, "Give a reason.").max(MAX_SIGNOFF_REASON),
});
export type SignoffRevokeBody = z.infer<typeof SignoffRevokeBodySchema>;

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

export type SignoffResult =
  | {
      ok: true;
      todo: Todo;
      /** The checkpoint that changed. */
      checkpointId: string;
      /** For the audit line (never message text). */
      audit: Record<string, unknown>;
    }
  | { ok: false; reason: string };

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

const trunc = (text: string, max = 160) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

const SENT_LABEL = /\b(sent|submitted|issued)\b/i;
const DRAFT_LABEL = /\bdraft/i;

function indexOfCheckpoint(
  todo: Todo,
  id: string | undefined,
  want: (c: Checkpoint) => boolean,
) {
  if (id !== undefined) {
    const at = todo.checkpoints.findIndex((c) => c.id === id);
    return at >= 0 && isApproval(todo.checkpoints[at]) ? at : -1;
  }
  return todo.checkpoints.findIndex((c) => isApproval(c) && want(c));
}

/** The step "Sent for sign-off": the nearest earlier step that says it was sent. */
function sentIndex(todo: Todo, approvalAt: number): number {
  for (let i = approvalAt - 1; i >= 0; i--) {
    const c = todo.checkpoints[i];
    if (c.kind === "step" && SENT_LABEL.test(c.label)) return i;
  }
  return -1;
}

/** The Draft step: the first earlier step that says draft. */
function draftIndex(todo: Todo, approvalAt: number): number {
  for (let i = 0; i < approvalAt; i++) {
    const c = todo.checkpoints[i];
    if (c.kind === "step" && DRAFT_LABEL.test(c.label)) return i;
  }
  return -1;
}

function withCheckpoint(
  todo: Todo,
  index: number,
  change: (checkpoint: Checkpoint) => Checkpoint,
): Todo["checkpoints"] {
  return todo.checkpoints.map((c, i) => (i === index ? change(c) : c));
}

const setDone = (c: Checkpoint, now: string): Checkpoint => ({
  ...c,
  state: "done",
  doneAt: now,
});
const setPending = (c: Checkpoint): Checkpoint => ({
  ...c,
  state: "pending",
  doneAt: null,
});

const withSignoff = (c: Checkpoint, signoff: Signoff): Checkpoint => ({ ...c, signoff });

function closedTodo(todo: Todo): { ok: false; reason: string } | null {
  return todo.status === "open" ? null : fail("Reopen the to-do first.");
}

const NO_APPROVAL_STEP =
  "This to-do has no sign-off step. Add a checkpoint marked as a sign-off step first.";

function pushPrevious(
  signoff: Signoff,
  ended: { kind: "revoked" | "superseded"; by: string; at: string; reason: string },
): Signoff["previous"] {
  if (!signoff.stamp && signoff.outcome === "pending" && !signoff.requestedAt) {
    return signoff.previous;
  }
  const entry = {
    approver: signoff.approver,
    requestedAt: signoff.requestedAt,
    outcome: signoff.outcome,
    conditions: signoff.conditions,
    stamp: signoff.stamp,
    ended,
  };
  return [...signoff.previous, entry].slice(-MAX_SIGNOFF_PREVIOUS);
}

export interface RequestInput {
  checkpointId?: string;
  /** Who must sign off; undefined keeps the saved approver. */
  approver?: string | null;
  now: string;
  /** The OS user, from the server. */
  by: string;
}

/**
 * The person has SENT the request (the app cannot know, so they say so): record
 * when and by whom, remember the approver, mark the to-do as waiting on them (so
 * the chaser reminders work) and tick "Sent for sign-off".
 */
export function requestSignoff(todo: Todo, input: RequestInput): SignoffResult {
  const closed = closedTodo(todo);
  if (closed) return closed;
  const at = indexOfCheckpoint(todo, input.checkpointId, (c) => c.state !== "done");
  if (at < 0) {
    return fail(
      approvalCheckpoints(todo).length === 0
        ? NO_APPROVAL_STEP
        : "That is not a sign-off step, or it is already complete.",
    );
  }
  const checkpoint = todo.checkpoints[at];
  const current = signoffOf(checkpoint);
  if (checkpoint.state === "skipped") {
    return fail("That sign-off step was skipped. Reopen it first.");
  }
  if (checkpoint.state === "done") {
    return fail("That sign-off step is already complete.");
  }
  if (
    current.stamp &&
    (current.outcome === "approved" || current.outcome === "approved_with_conditions")
  ) {
    return fail(
      "A sign-off is already on record. Revoke it (with a reason) before requesting another.",
    );
  }

  const approver =
    input.approver === undefined ? current.approver : input.approver?.trim() || null;
  const who = approverName(approver);

  // A new round after "changes requested" or "rejected": the earlier answer is
  // kept on the checkpoint, unchanged, and the request starts afresh.
  const previous = current.stamp
    ? pushPrevious(current, {
        kind: "superseded",
        by: input.by,
        at: input.now,
        reason: "",
      })
    : current.previous;
  const signoff: Signoff = {
    ...emptySignoff(),
    approver,
    requestedAt: input.now,
    requestedBy: input.by,
    waitingMarked: who,
    previous,
  };

  let checkpoints = withCheckpoint(todo, at, (c) => withSignoff(c, signoff));
  const sent = sentIndex(todo, at);
  let advanced = false;
  if (sent >= 0 && todo.checkpoints[sent].state !== "done") {
    checkpoints = checkpoints.map((c, i) => (i === sent ? setDone(c, input.now) : c));
    advanced = true;
  }
  // Sending the request means the draft is finished: tick the Draft step too, so
  // the stage does not stay on "Draft" while the sign-off is awaited. (Only a
  // step labelled draft that is still pending; nothing else is touched.)
  const draft = draftIndex(todo, at);
  let draftDone = false;
  if (draft >= 0 && todo.checkpoints[draft].state === "pending") {
    checkpoints = checkpoints.map((c, i) => (i === draft ? setDone(c, input.now) : c));
    draftDone = true;
  }

  let history: HistoryEntry[] = appendHistory(
    todo.history,
    historyEntry(
      "signoff",
      who
        ? `Sign-off requested from ${who}${current.requestedAt ? " again" : ""} (marked as sent by ${input.by}; this app does not send anything).`
        : `Sign-off requested (marked as sent by ${input.by}); no approver is named, so no reminder is set.`,
      input.now,
    ),
  );
  const next: Todo = { ...todo, checkpoints, updatedAt: input.now };
  if (who) {
    next.waitingOn = who;
    next.waitingSince = input.now;
    history = appendHistory(
      history,
      historyEntry("waiting", `Waiting on ${who} (sign-off requested).`, input.now),
    );
  }
  next.history = history;
  return {
    ok: true,
    todo: next,
    checkpointId: checkpoint.id,
    audit: {
      checkpointId: checkpoint.id,
      approver: who,
      advanced,
      draftDone,
      waiting: !!who,
      again: !!current.requestedAt,
    },
  };
}

export interface RecordInput {
  checkpointId?: string;
  outcome: RecordableOutcome;
  conditions?: string;
  evidence: { intakeId: string | null; messageLink: string | null; note: string };
  now: string;
  by: string;
  /** The message's sender, for the timeline line of a reply (display only). */
  from?: string | null;
}

/**
 * Write the outcome and its stamp. `approved` completes the sign-off step;
 * `approved_with_conditions` records the conditions and leaves the step open;
 * `changes_requested` and `rejected` reopen the Draft (and "Sent for sign-off")
 * steps and keep the outcome visible. The stamp's identity and time are the
 * arguments `by` and `now` (the server's), and it can never be replaced.
 */
export function recordSignoff(todo: Todo, input: RecordInput): SignoffResult {
  const closed = closedTodo(todo);
  if (closed) return closed;
  const at = indexOfCheckpoint(todo, input.checkpointId, (c) => c.state !== "done");
  if (at < 0) {
    return fail(
      approvalCheckpoints(todo).length === 0
        ? NO_APPROVAL_STEP
        : "That is not a sign-off step, or it is already complete.",
    );
  }
  const checkpoint = todo.checkpoints[at];
  const current = signoffOf(checkpoint);
  if (checkpoint.state === "skipped") {
    return fail("That sign-off step was skipped. Reopen it first.");
  }
  if (checkpoint.state === "done") {
    return fail("That sign-off step is already complete.");
  }
  // An earlier "changes requested" / "rejected" answer is not a sign-off: a new
  // answer replaces it, and the old one is kept, unchanged, in `previous`.
  const answered = current.stamp
    ? current.outcome === "changes_requested" || current.outcome === "rejected"
    : false;
  if (current.stamp && !answered) {
    return fail(
      "A sign-off is already on record and cannot be changed. Revoke it (with a reason) to record another.",
    );
  }

  const conditions = (input.conditions ?? "").trim();
  const note = input.evidence.note.trim();
  if (!note && !input.evidence.intakeId) {
    return fail(
      "Say where the sign-off came from (for example: email from Priya, 26 Oct).",
    );
  }
  if (
    (input.outcome === "approved_with_conditions" ||
      input.outcome === "changes_requested") &&
    !conditions
  ) {
    return fail(
      input.outcome === "changes_requested"
        ? "Write down the changes that were asked for."
        : "Write down the conditions.",
    );
  }

  const who = approverName(current.approver);
  const stamp = {
    recordedBy: input.by,
    recordedAt: input.now,
    evidence: {
      intakeId: input.evidence.intakeId,
      messageLink: input.evidence.messageLink,
      note,
    },
  };
  const base: Signoff = answered
    ? {
        ...emptySignoff(),
        approver: current.approver,
        requestedAt: current.requestedAt,
        requestedBy: current.requestedBy,
        previous: pushPrevious(current, {
          kind: "superseded",
          by: input.by,
          at: input.now,
          reason: "",
        }),
      }
    : current;
  const signoff: Signoff = {
    ...base,
    outcome: input.outcome,
    conditions,
    conditionsConfirmedAt: null,
    conditionsConfirmedBy: null,
    stamp,
  };

  let checkpoints = withCheckpoint(todo, at, (c) => {
    const updated = withSignoff(c, signoff);
    return input.outcome === "approved" ? setDone(updated, input.now) : updated;
  });
  let reopened: string[] = [];
  if (input.outcome === "changes_requested" || input.outcome === "rejected") {
    const draft = draftIndex(todo, at);
    const sent = sentIndex(todo, at);
    const targets = [draft, sent].filter((i, n, all) => i >= 0 && all.indexOf(i) === n);
    checkpoints = checkpoints.map((c, i) => (targets.includes(i) ? setPending(c) : c));
    reopened = targets.map((i) => todo.checkpoints[i].label);
  }

  const from = who ? ` from ${who}` : "";
  const line = (() => {
    switch (input.outcome) {
      case "approved":
        return `Sign-off received${from}: approved. Recorded by ${input.by}.`;
      case "approved_with_conditions":
        return `Approved with conditions${from}: ${trunc(conditions)} Recorded by ${input.by}; the sign-off step stays open until the conditions are confirmed as met.`;
      case "changes_requested":
        return `Changes requested${from}: ${trunc(conditions)} Recorded by ${input.by}.${reopened.length ? ` Reopened: ${reopened.join(", ")}.` : ""}`;
      case "rejected":
        return `Rejected${from}.${conditions ? ` ${trunc(conditions)}` : ""} Recorded by ${input.by}.${reopened.length ? ` Reopened: ${reopened.join(", ")}.` : ""}`;
    }
  })();
  let history = appendHistory(
    todo.history,
    historyEntry("signoff", line, input.now, {
      intakeId: input.evidence.intakeId,
      from: input.from ?? null,
    }),
  );

  const next: Todo = { ...todo, checkpoints, updatedAt: input.now };
  // The answer is the reply the request was waiting for: clear that waiting
  // (only the waiting the request itself set).
  const marked = base.waitingMarked?.trim();
  let clearedWaiting = false;
  if (marked && next.waitingOn?.trim() === marked) {
    next.waitingOn = null;
    next.waitingSince = null;
    clearedWaiting = true;
    history = appendHistory(
      history,
      historyEntry(
        "waiting",
        `Got a reply / no longer waiting (was waiting on ${marked}).`,
        input.now,
      ),
    );
  }
  next.history = history;
  return {
    ok: true,
    todo: next,
    checkpointId: checkpoint.id,
    audit: {
      checkpointId: checkpoint.id,
      outcome: input.outcome,
      evidenceIntakeId: input.evidence.intakeId,
      reopened,
      clearedWaiting,
    },
  };
}

/** A person confirms that the conditions of an "approved with conditions"
 *  sign-off are met: now (and only now) the step is complete. */
export function confirmConditions(
  todo: Todo,
  input: { checkpointId?: string; now: string; by: string },
): SignoffResult {
  const closed = closedTodo(todo);
  if (closed) return closed;
  const at = indexOfCheckpoint(
    todo,
    input.checkpointId,
    (c) => signoffState(c) === "conditions",
  );
  if (at < 0) return fail("There are no open conditions to confirm.");
  const checkpoint = todo.checkpoints[at];
  if (signoffState(checkpoint) !== "conditions") {
    return fail("There are no open conditions to confirm.");
  }
  const current = signoffOf(checkpoint);
  const signoff: Signoff = {
    ...current,
    conditionsConfirmedAt: input.now,
    conditionsConfirmedBy: input.by,
  };
  const next: Todo = {
    ...todo,
    checkpoints: withCheckpoint(todo, at, (c) =>
      setDone(withSignoff(c, signoff), input.now),
    ),
    updatedAt: input.now,
    history: appendHistory(
      todo.history,
      historyEntry(
        "signoff",
        `Conditions confirmed as met by ${input.by}. Sign-off complete.`,
        input.now,
      ),
    ),
  };
  return {
    ok: true,
    todo: next,
    checkpointId: checkpoint.id,
    audit: { checkpointId: checkpoint.id },
  };
}

/** The only undo. Needs a reason; the old stamp is kept, unchanged, in
 *  `previous` and in the timeline, and the step goes back to waiting for a
 *  request. */
export function revokeSignoff(
  todo: Todo,
  input: { checkpointId?: string; reason: string; now: string; by: string },
): SignoffResult {
  const closed = closedTodo(todo);
  if (closed) return closed;
  const reason = input.reason.trim();
  if (reason.length < 3) return fail("Give a reason for revoking the sign-off.");
  const at = indexOfCheckpoint(todo, input.checkpointId, (c) => !!signoffOf(c).stamp);
  if (at < 0) return fail("There is no sign-off on record to revoke.");
  const checkpoint = todo.checkpoints[at];
  const current = signoffOf(checkpoint);
  if (!current.stamp) return fail("There is no sign-off on record to revoke.");

  const previous = pushPrevious(current, {
    kind: "revoked",
    by: input.by,
    at: input.now,
    reason: reason.slice(0, MAX_SIGNOFF_REASON),
  });
  const signoff: Signoff = {
    ...emptySignoff(),
    approver: current.approver,
    previous,
  };
  const next: Todo = {
    ...todo,
    checkpoints: withCheckpoint(todo, at, (c) => setPending(withSignoff(c, signoff))),
    updatedAt: input.now,
    history: appendHistory(
      todo.history,
      historyEntry(
        "signoff",
        `Sign-off revoked by ${input.by}: ${trunc(reason, 200)} (Earlier record: ${SIGNOFF_OUTCOME_LABEL[current.outcome].toLowerCase()}, recorded by ${current.stamp.recordedBy} on ${current.stamp.recordedAt.slice(0, 10)}.)`,
        input.now,
      ),
    ),
  };
  return {
    ok: true,
    todo: next,
    checkpointId: checkpoint.id,
    audit: {
      checkpointId: checkpoint.id,
      revokedOutcome: current.outcome,
      revokedStampBy: current.stamp.recordedBy,
      revokedStampAt: current.stamp.recordedAt,
      reason: reason.slice(0, MAX_SIGNOFF_REASON),
    },
  };
}

// ---------------------------------------------------------------------------
// The generic PATCH route must not touch a sign-off
// ---------------------------------------------------------------------------

/**
 * Why a PATCH may not be applied, or null. The generic edit route cannot tick a
 * sign-off step as done (only a recorded sign-off completes it), cannot move a
 * step that carries a stamp, and cannot delete one (that would erase the
 * evidence). Skipping an unsigned step, and reopening one that was skipped or
 * ticked before phase 6, stay possible: they are the person's own decision and
 * produce no stamp.
 */
export function signoffPatchProblem(
  todo: Pick<Todo, "checkpoints">,
  patch: Pick<TodoPatch, "checkpoints" | "removeCheckpointIds">,
): string | null {
  const byId = new Map(todo.checkpoints.map((c) => [c.id, c]));
  for (const entry of patch.checkpoints ?? []) {
    const checkpoint = byId.get(entry.id);
    if (!checkpoint || !isApproval(checkpoint)) continue;
    if (checkpoint.state === entry.state) continue;
    if (signoffOf(checkpoint).stamp) {
      return `“${checkpoint.label}” has a sign-off on record. Use Revoke sign-off (with a reason) to undo it.`;
    }
    if (entry.state === "done") {
      return `“${checkpoint.label}” is a sign-off step: it is completed by recording the sign-off, not by ticking it.`;
    }
  }
  for (const id of patch.removeCheckpointIds ?? []) {
    const checkpoint = byId.get(id);
    if (checkpoint && isApproval(checkpoint) && signoffOf(checkpoint).stamp) {
      return `“${checkpoint.label}” has a sign-off on record and cannot be removed. Revoke the sign-off first.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reading a reply: the guards around the model's classification
// ---------------------------------------------------------------------------

// Wording aimed at the assistant rather than at the person. A reply that carries
// it can never be classified as a sign-off by the server, whatever the model said.
const INJECTION: RegExp[] = [
  /\bignore\b[^.\n]{0,40}\b(rules?|instructions?|prompts?|guidelines?|above|previous|prior)\b/i,
  /\bdisregard\b[^.\n]{0,40}\b(rules?|instructions?|prompts?|above|previous|prior)\b/i,
  /\b(mark|set|classify|record|label|treat|flag|log|register)\b[^.\n]{0,25}\b(this|it|that|the (item|task|request|message|reply|sign-?off|approval|step|pack))\b[^.\n]{0,25}\b(as )?(approved|signed[- ]?off|received|complete|completed|done|confirmed)\b/i,
  /\b(system|developer) (prompt|message|instructions?)\b|\[\s*system\s*\]|^\s*system\s*:/im,
  /\byou are (?:now )?(?:an? |the )?(?:ai|assistant|model|llm|bot|chatbot)\b/i,
  /\b(as an? )?(ai|language model|llm)\b[^.\n]{0,20}\b(you|must|should|answer|respond|output)\b/i,
  // A message that talks to "the assistant" or "the model" is not an email to a
  // person. (A real reply that mentions someone's "assistant" is lowered too, and
  // shown unticked for a person to read.)
  /\b(the |this |an? )?(assistant|chat ?bot|llm|language model|classifier|ai (model|tool|system))\b/i,
  /\b(output|emit|return)\b[^.\n]{0,30}\b(sign-?off|json|classification|verdict|label)\b/i,
  /\banswer (only )?with\b|\brespond (only )?with\b|\boutput (only )?(the )?json\b/i,
  /"signoff"\s*:\s*"approved/i,
  /\bnew (rules?|instructions?)\b/i,
];

/** Does the text try to instruct the assistant? (Conservative: a real reply that
 *  says "please mark this as approved" is also flagged, and is then shown
 *  unticked for a person to read.) */
export function looksLikeInjection(text: string | null | undefined): boolean {
  const body = text ?? "";
  return INJECTION.some((pattern) => pattern.test(body));
}

const APPROVAL_WORDS =
  /\b(approv\w*|sign(?:ed|ing)?[- ]?off|agree\w*|happy (?:with|to (?:proceed|go|sign))|go(?:ing)? ahead|good to go|ok(?:ay)? (?:to|with|by)|lgtm|confirm\w*|accept\w*|looks? (?:good|fine|great)|no (?:further )?(?:comments?|objections?|concerns?)|cleared|fine (?:by|with) me|you (?:can|may) proceed|proceed)\b/i;
const NEGATION =
  /\b(not|never|cannot|can'?t|won'?t|don'?t|do not|unable|no longer|haven'?t|hasn'?t|isn'?t|aren'?t)\b/i;
const CONDITIONAL =
  /\b(subject to|provided|providing|unless|once|before|if|but|however|except|pending|until|as long as|on condition|only if|assuming|after)\b/i;

/**
 * Is this quoted sentence a clean, unconditional approval? Used (with the
 * sender and the verified quote) to decide whether "mark received" is pre-ticked:
 * it needs approval wording, no negation, no condition, and no wording aimed at
 * the assistant.
 */
export function approvalQuoteIsClean(quote: string | null | undefined): boolean {
  const text = (quote ?? "").trim();
  if (text.length < 4) return false;
  return (
    APPROVAL_WORDS.test(text) &&
    !NEGATION.test(text) &&
    !CONDITIONAL.test(text) &&
    !looksLikeInjection(text)
  );
}

export interface SignoffReading {
  signoff: SignoffClass;
  signoffQuote: string;
  signoffQuoteVerified: boolean;
  /** Why the server lowered the model's answer, or null. */
  signoffGuard: string | null;
}

/**
 * What the server stores from the model's sign-off classification: the quote is
 * checked against the message, and an answer that could have been steered by the
 * message (it carries wording aimed at the assistant) is lowered to "unclear",
 * so a hostile reply can never produce a recordable outcome by itself.
 */
export function readSignoff(
  output: Pick<AiUpdate, "signoff" | "signoffQuote">,
  bodyText: string,
  subject = "",
): SignoffReading {
  const claimed: SignoffClass = SIGNOFF_CLASSES.includes(output.signoff as SignoffClass)
    ? (output.signoff as SignoffClass)
    : "not_a_signoff";
  const grounded = groundQuote(bodyText, output.signoffQuote);
  let signoff = claimed;
  let guard: string | null = null;
  const recordable = RECORDABLE_OUTCOMES.includes(claimed as RecordableOutcome);
  if (recordable && looksLikeInjection(`${subject}\n${bodyText}`)) {
    signoff = "unclear";
    guard =
      "The message contains wording aimed at the assistant, so it was not treated as a sign-off. Read it yourself.";
  }
  return {
    signoff,
    signoffQuote: grounded.quote,
    signoffQuoteVerified: grounded.verified,
    signoffGuard: guard,
  };
}
