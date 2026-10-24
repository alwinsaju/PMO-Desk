// Turns the model's small "what does this new message change?" answer into a
// concrete, reviewable patch for an existing to-do. The model only labels and
// fills a few fields; everything that touches the to-do is built here, by
// code, and shown to the human as a before -> after list they approve. Pure
// (no node imports), shared by the server (which applies) and the review card
// (which shows).
import {
  SIGNOFF_OUTCOME_LABEL,
  approvalQuoteIsClean,
  approverName,
  awaitingSignoff,
  senderIsApprover,
  type RecordableOutcome,
} from "./signoff.ts";
import { istDate } from "./time.ts";
import { looksLikeReplyFrom } from "./thread.ts";
import type { TodoPatch } from "./todoLogic.ts";
import type { AiUpdate, SignoffClass, Todo, UpdateKind } from "./types.ts";

export const UPDATE_KIND_LABEL: Record<UpdateKind, string> = {
  unrelated: "Not about this to-do",
  reply: "Reply",
  "new-info": "New information",
  "new-action": "New action item",
  "due-change": "Changed due date",
  nothing: "Nothing actionable",
};

export interface UpdateChange {
  /** Stable within one plan: "waiting", "due", "note", "action:0", ... */
  id: string;
  kind: "waiting" | "due" | "note" | "action" | "signoff";
  label: string;
  /** What it says now and what it would say (display text). */
  before: string | null;
  after: string | null;
  /** Ticked when the card opens. */
  defaultOn: boolean;
  /** A caution or suggestion shown under the line. */
  hint?: string;
  /** The to-do patch this change stands for (empty for a sign-off, which is
   *  recorded by the sign-off logic with the server's identity and time). */
  patch: TodoPatch;
  /** A sign-off change: what would be recorded. */
  signoff?: {
    checkpointId: string;
    outcome: RecordableOutcome;
    conditions: string;
    quote: string;
  };
}

/** What the reply said about the sign-off the to-do is awaiting (phase 6). */
export interface SignoffSuggestion {
  classification: SignoffClass;
  /** The outcome that could be recorded; null for "unclear" / "not a sign-off". */
  outcome: RecordableOutcome | null;
  /** Who the sign-off is awaited from, and who wrote the reply. */
  approver: string | null;
  from: string;
  senderIsApprover: boolean;
  quote: string;
  quoteVerified: boolean;
  /** The model's own reasoning, shown on the card. */
  reason: string;
  /** Why the server lowered the model's answer, if it did. */
  guard: string | null;
  /** The id of the change that records it (absent when nothing is recordable). */
  changeId: string | null;
}

export interface UpdateSender {
  name?: string | null;
  address?: string | null;
}

export interface UpdateContext {
  sender: UpdateSender;
  /** When the new message arrived (for the dated note). */
  receivedAt: string;
}

export interface UpdatePlan {
  changes: UpdateChange[];
  /** The sender when they look like the person the to-do waits on. */
  replyFrom: string | null;
  /** What the card calls this: the model's kind, but "nothing" when no change
   *  survives the checks below (a "nothing" answer stays "nothing" even if the
   *  unticked reply suggestion is offered). */
  kind: UpdateKind;
  /** Set when the to-do was awaiting a sign-off and the model read a reply to it. */
  signoff: SignoffSuggestion | null;
}

const dayLabel = (day: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${day}T00:00:00Z`));

const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const senderLabel = (sender: UpdateSender) =>
  sender.name?.trim() || sender.address?.trim() || "the sender";

/** The most a to-do description can hold (TodoPatchSchema). */
const MAX_DESCRIPTION = 4000;

/**
 * What approving this update would change in `todo`. Checks that make it
 * conservative: a due date equal to the current one, an action item the to-do
 * already has, and "clear waiting" on a to-do that is not waiting are all
 * dropped. "Clear waiting" is only ticked when the sender looks like the person
 * waited on AND the model agrees the message answers it.
 */
export function planUpdate(todo: Todo, result: AiUpdate, ctx: UpdateContext): UpdatePlan {
  const changes: UpdateChange[] = [];
  const sender = senderLabel(ctx.sender);
  const waitingOn = todo.waitingOn?.trim() || null;
  const replyFrom = waitingOn && looksLikeReplyFrom(waitingOn, ctx.sender) ? sender : null;
  let signoff: SignoffSuggestion | null = null;

  if (result.kind !== "unrelated") {
    // First, because it is the important one. Never ticked unless the sender IS
    // the named approver, the model says "approved", and the quoted sentence is
    // really in the message and reads as a clean, unconditional approval.
    const awaiting = awaitingSignoff(todo);
    if (awaiting && result.signoff && result.signoff !== "not_a_signoff") {
      const classification = result.signoff;
      const outcome: RecordableOutcome | null =
        classification === "unclear" ? null : classification;
      const quote = (result.signoffQuote ?? "").trim();
      const verified = result.signoffQuoteVerified === true && quote !== "";
      const isApprover = senderIsApprover(awaiting.approver, ctx.sender);
      const approver = approverName(awaiting.approver);
      const reason = result.signoffReason?.trim() || result.reason;
      signoff = {
        classification,
        outcome,
        approver,
        from: sender,
        senderIsApprover: isApprover,
        quote,
        quoteVerified: verified,
        reason,
        guard: result.signoffGuard ?? null,
        changeId: outcome ? "signoff" : null,
      };
      if (outcome) {
        const sure =
          outcome === "approved" && isApprover && verified && approvalQuoteIsClean(quote);
        const who = approver ?? "the approver";
        const hint = [
          outcome === "approved"
            ? isApprover
              ? `Looks like sign-off from ${sender}: mark received?`
              : `The model reads this as an approval, but ${sender} is not obviously ${who}. Check before recording it.`
            : outcome === "approved_with_conditions"
              ? `${isApprover ? sender : `${sender} (not obviously ${who})`} approved with conditions. Recording keeps the step open until you confirm the conditions are met.`
              : outcome === "changes_requested"
                ? `${isApprover ? sender : `${sender} (not obviously ${who})`} asked for changes. Recording reopens the Draft step.`
                : `${isApprover ? sender : `${sender} (not obviously ${who})`} declined. Recording reopens the Draft step.`,
          outcome === "approved" && isApprover && !sure
            ? verified
              ? "The sentence does not read as a plain approval, so it is not ticked."
              : "The quoted sentence was not found in the message, so it is not ticked."
            : "",
        ]
          .filter(Boolean)
          .join(" ");
        changes.push({
          id: "signoff",
          kind: "signoff",
          label: "Sign-off",
          before: `Awaiting sign-off${approver ? ` from ${approver}` : ""}`,
          after: SIGNOFF_OUTCOME_LABEL[outcome],
          defaultOn: sure,
          hint,
          patch: {},
          signoff: {
            checkpointId: awaiting.checkpoint.id,
            outcome,
            conditions:
              outcome === "approved_with_conditions" || outcome === "changes_requested"
                ? quote || result.summary || ""
                : "",
            quote,
          },
        });
      }
    }

    if (waitingOn && (result.clearsWaiting || replyFrom)) {
      const modelAgrees = result.clearsWaiting || result.kind === "reply";
      changes.push({
        id: "waiting",
        kind: "waiting",
        label: "Waiting on",
        before: waitingOn,
        after: "(not waiting)",
        defaultOn: !!replyFrom && modelAgrees,
        hint: replyFrom
          ? `Looks like a reply from ${replyFrom}: clear waiting?`
          : `The model thinks this answers what you were waiting for, but ${sender} is not obviously ${waitingOn}.`,
        patch: { waitingOn: null },
      });
    }

    if (result.newDueAt && result.newDueAt !== todo.dueAt) {
      changes.push({
        id: "due",
        kind: "due",
        label: "Due date",
        before: todo.dueAt ? dayLabel(todo.dueAt) : "(none)",
        after: dayLabel(result.newDueAt),
        defaultOn: true,
        patch: { dueAt: result.newDueAt },
      });
    }

    const existing = new Set(todo.actionItems.map((item) => squash(item.text)));
    result.newActionItems.forEach((item, index) => {
      const key = squash(item.text);
      if (!key || existing.has(key)) return;
      existing.add(key);
      const extra = [item.owner, item.dueAt ? `due ${dayLabel(item.dueAt)}` : null]
        .filter(Boolean)
        .join(", ");
      changes.push({
        id: `action:${index}`,
        kind: "action",
        label: "New action item",
        before: null,
        after: extra ? `${item.text} (${extra})` : item.text,
        defaultOn: true,
        patch: {
          addActionItems: [{ text: item.text, owner: item.owner, dueAt: item.dueAt }],
        },
      });
    });

    // A "nothing" answer carries no information, whatever the model put in `note`.
    const note = result.kind === "nothing" ? "" : result.note?.trim();
    if (note) {
      const received = Number.isNaN(Date.parse(ctx.receivedAt))
        ? null
        : istDate(ctx.receivedAt);
      const line = `Update${received ? ` ${dayLabel(received)}` : ""}: ${note}`;
      const description = todo.description.trimEnd();
      const next = description ? `${description}\n\n${line}` : line;
      if (next.length <= MAX_DESCRIPTION) {
        changes.push({
          id: "note",
          kind: "note",
          label: "Adds to the description",
          before: null,
          after: line,
          defaultOn: true,
          patch: { description: next },
        });
      }
    }
  }

  const kind: UpdateKind =
    result.kind === "unrelated"
      ? "unrelated"
      : changes.length === 0
        ? "nothing"
        : result.kind;
  return { changes, replyFrom, kind, signoff };
}

/** Merge the patches of the ticked changes into one patch (an action item list
 *  is concatenated; every other field is set once). */
export function patchFromChanges(
  changes: readonly UpdateChange[],
  include: ReadonlySet<string>,
): TodoPatch {
  const merged: TodoPatch = {};
  for (const change of changes) {
    if (!include.has(change.id)) continue;
    const { addActionItems, ...rest } = change.patch;
    Object.assign(merged, rest);
    if (addActionItems?.length) {
      merged.addActionItems = [...(merged.addActionItems ?? []), ...addActionItems];
    }
  }
  return merged;
}

/** The changes ticked when the card opens. */
export const defaultInclude = (changes: readonly UpdateChange[]): string[] =>
  changes.filter((change) => change.defaultOn).map((change) => change.id);

/** One line for the to-do's timeline: what the message said and what was done. */
export function describeApplied(
  summary: string,
  applied: readonly UpdateChange[],
  declined: number,
): string {
  const parts = applied.map((change) => {
    switch (change.kind) {
      case "waiting":
        return "cleared waiting";
      case "due":
        return `due date now ${change.after}`;
      case "action":
        return `added action item "${change.after}"`;
      case "note":
        return "added a note to the description";
      case "signoff":
        return `recorded the sign-off (${(change.after ?? "").toLowerCase()})`;
    }
  });
  const did = parts.length ? `Applied: ${parts.join("; ")}.` : "Linked, no changes applied.";
  const skipped = declined > 0 ? ` (${declined} suggested change${declined === 1 ? "" : "s"} skipped.)` : "";
  return `${summary ? `${summary.replace(/\s+$/, "")} ` : ""}${did}${skipped}`.trim();
}
