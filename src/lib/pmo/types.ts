// Shared data shapes for the PMO To-Do app (see ARCHITECTURE.md, "PMO To-Do").
// Pure: only imports zod and the other pure PMO modules, so both the server
// modules and the client UI can import it, and `pnpm test` can load it under plain Node.
import { z } from "zod";
import type { Attention } from "./due.ts";
import { checkDomain, checkEmail, type Checked } from "./listValidation.ts";
import {
  DEFAULT_TIME_ZONE as TIME_ZONE_DEFAULT,
  isRealIsoDay,
  isRealIsoInstant,
  isValidTimeZone,
} from "./time.ts";

export const INTAKE_SCHEMA_ID = "pmo-intake/1";
export const SOURCES = ["outlook", "teams", "manual"] as const;
export type Source = (typeof SOURCES)[number];

/** Power Automate emits `null` for anything it can't resolve; treat that the
 *  same as a missing key. */
const optText = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined);

// ---------------------------------------------------------------------------
// Intake: the producer contract, `pmo-intake/1` (pmo-intake/PMO-INTAKE-CONTRACT.md)
// ---------------------------------------------------------------------------

const IntakePerson = z.object({ name: optText, address: optText });
const IntakeRecipient = z.object({
  name: optText,
  address: optText,
  role: optText, // to | cc | bcc | ...
});

const IntakeThread = z.object({ conversationId: optText, parentId: optText });
const IntakeContext = z.object({
  /** Manual paste only: where the pasted text came from (teams, outlook, manual). */
  origin: optText,
  tenantId: optText,
  chatId: optText,
  chatType: optText,
  teamName: optText,
  channelName: optText,
  mailbox: optText,
  importance: optText,
});
type IntakeContextShape = z.output<typeof IntakeContext>;

export const IntakeSchema = z.object({
  schema: z.literal(INTAKE_SCHEMA_ID),
  producer: optText.transform((value) => value ?? "other"),
  source: z.enum(SOURCES),
  // Required, but may be blank (or null): ingest then derives a stable id from
  // the content (dedupe.ts deriveSourceId), as the intake contract says.
  sourceId: z
    .string()
    .nullable()
    .transform((value) => value?.trim() ?? ""),
  receivedAt: z.string().refine(isRealIsoInstant, {
    message: "receivedAt must be an ISO 8601 date-time on a real calendar day",
  }),
  // Teams gives a display name only, so neither field is required on its own.
  sender: IntakePerson,
  recipients: z
    .array(IntakeRecipient)
    .nullish()
    .transform((value) => value ?? []),
  subject: z
    .string()
    .nullable()
    .transform((value) => value ?? ""),
  body: z.object({
    text: z.string(),
    format: z
      .enum(["text", "html"])
      .nullish()
      .transform((value) => value ?? "text"),
  }),
  thread: IntakeThread.nullish().transform((value) => value ?? {}),
  context: IntakeContext.nullish().transform(
    (value) => value ?? ({} as IntakeContextShape),
  ),
  attachments: z
    .array(
      z.object({
        name: optText,
        contentType: optText,
        size: z.number().nullish(),
        ref: optText,
      }),
    )
    .nullish()
    .transform((value) => value ?? []),
  link: optText,
});
export type Intake = z.output<typeof IntakeSchema>;

/** The slice of an intake the lists show without opening raw/<id>.json. */
export const IntakeSummarySchema = z.object({
  source: z.enum(SOURCES),
  subject: z.string(),
  senderName: z.string().nullable(),
  senderAddress: z.string().nullable(),
  receivedAt: z.string(),
  link: z.string().nullable(),
});
export type IntakeSummary = z.infer<typeof IntakeSummarySchema>;

/** raw/<intakeId>.json — immutable snapshot of an accepted intake. */
export const RawRecordSchema = z.object({
  intakeId: z.string(),
  dedupeKey: z.string(),
  fileName: z.string(),
  ingestedAt: z.string(),
  intake: IntakeSchema,
});
export type RawRecord = z.infer<typeof RawRecordSchema>;

/** quarantine/<intakeId>.json — a filtered item: metadata + reason only. The
 *  message body is deliberately NOT kept. */
export const QuarantineRecordSchema = z.object({
  id: z.string(),
  at: z.string(),
  code: z.string(),
  reason: z.string(),
  summary: IntakeSummarySchema,
  tenantId: z.string().nullable(),
  chatId: z.string().nullable(),
});
export type QuarantineRecord = z.infer<typeof QuarantineRecordSchema>;

// ---------------------------------------------------------------------------
// Checkpoints / to-do pieces
// ---------------------------------------------------------------------------

export const CHECKPOINT_TEMPLATE_IDS = [
  "simple",
  "deliverable",
  "approval",
  "followup",
] as const;
export type CheckpointTemplateId = (typeof CHECKPOINT_TEMPLATE_IDS)[number];

export const PRIORITIES = ["low", "normal", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** For what a person submits: a day that really exists. Stored records keep the
 *  lenient `isoDay`, so an older file with a bad date is still readable. */
const realIsoDay = isoDay.refine(isRealIsoDay, {
  message: "Not a real calendar date (for example 2026-02-30 does not exist).",
});
const isoInstant = z.string().refine(isRealIsoInstant, {
  message: "Not an ISO 8601 date-time on a real calendar day",
});

/** Longest "Repeats" text (the model's and the person's). */
export const RECURRENCE_MAX = 80;

export const DEFAULT_CHASER_DAYS = 2;
export const MAX_CHASER_DAYS = 30;
export const MAX_LEAD_WORKING_DAYS = 5;

const OwnerSchema = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  isMe: z.boolean().nullable(),
});
const RequesterSchema = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
});
export type Owner = z.infer<typeof OwnerSchema>;
export type Requester = z.infer<typeof RequesterSchema>;

const actionItemDraftWith = (day: typeof isoDay) =>
  z.object({
    text: z.string().trim().min(1).max(200),
    owner: z.string().nullable(),
    dueAt: day.nullable(),
  });
/** What a person submits (a real calendar date is required). */
export const ActionItemDraftSchema = actionItemDraftWith(realIsoDay);
export type ActionItemDraft = z.infer<typeof ActionItemDraftSchema>;

const todoDraftWith = (day: typeof isoDay) =>
  z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(4000),
    owner: OwnerSchema,
    requester: RequesterSchema,
    dueAt: day.nullable(),
    priority: z.enum(PRIORITIES),
    actionItems: z.array(actionItemDraftWith(day)).max(30),
    checkpointTemplate: z.enum(CHECKPOINT_TEMPLATE_IDS),
    waitingOn: z.string().nullable(),
    /** When the waiting started; absent = the moment of approval. */
    waitingSince: isoInstant.nullable().optional(),
    tags: z.array(z.string()).max(10),
    /** "weekly, before Tuesday": informational only for now (nothing re-creates
     *  or re-reminds a repeating to-do). null = a one-off. */
    recurrence: z.string().trim().max(RECURRENCE_MAX).nullable().default(null),
  });

/** What the human reviews and approves; becomes a Todo. Strict about dates. */
export const TodoDraftSchema = todoDraftWith(realIsoDay);
export type TodoDraft = z.infer<typeof TodoDraftSchema>;
/** The same shape as stored in `proposal.edits`: lenient about dates so an
 *  older record is never refused on read. */
const StoredTodoDraftSchema = todoDraftWith(isoDay);

export const ActionItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  done: z.boolean(),
  owner: z.string().nullable().optional(),
  dueAt: isoDay.nullable().optional(),
});
export type ActionItem = z.infer<typeof ActionItemSchema>;

// --- sign-off (phase 6) ------------------------------------------------------------
// An approval-kind checkpoint can carry sign-off state. Everything that proves a
// sign-off (who recorded it, when, on what evidence) is written ONLY by the
// server's sign-off actions (server/signoff.ts): the client never supplies an
// identity or a time, and the generic PATCH route cannot touch any of it. See
// ARCHITECTURE.md, "Phase 6".

export const SIGNOFF_OUTCOMES = [
  "pending",
  "approved",
  "approved_with_conditions",
  "changes_requested",
  "rejected",
] as const;
export type SignoffOutcome = (typeof SIGNOFF_OUTCOMES)[number];

/** Limits on the free text a sign-off carries. */
export const MAX_SIGNOFF_TEXT = 1000;
export const MAX_SIGNOFF_NOTE = 500;
export const MAX_SIGNOFF_REASON = 300;
export const MAX_SIGNOFF_APPROVER = 200;
/** Superseded or revoked sign-offs kept on a checkpoint (the audit log keeps all). */
export const MAX_SIGNOFF_PREVIOUS = 10;

export const SignoffEvidenceSchema = z.object({
  /** A message in this app (raw/<intakeId>.json) that shows the sign-off. */
  intakeId: z.string().nullable().default(null),
  /** The message's own link, when it had one. */
  messageLink: z.string().nullable().default(null),
  note: z.string().default(""),
});
export type SignoffEvidence = z.infer<typeof SignoffEvidenceSchema>;

/** Written once, by the server, and never edited: the only way to undo it is
 *  `revokeSignoff`, which moves it (unchanged) into `previous`. */
export const SignoffStampSchema = z.object({
  /** The OS user of the machine running the server; never taken from a request. */
  recordedBy: z.string(),
  /** UTC instant from the server's clock; never taken from a request. */
  recordedAt: z.string(),
  evidence: SignoffEvidenceSchema,
});
export type SignoffStamp = z.infer<typeof SignoffStampSchema>;

export const PreviousSignoffSchema = z.object({
  approver: z.string().nullable().default(null),
  requestedAt: z.string().nullable().default(null),
  outcome: z.enum(SIGNOFF_OUTCOMES),
  conditions: z.string().default(""),
  stamp: SignoffStampSchema.nullable().default(null),
  /** How it ended: a person revoked it (with a reason), or a new request replaced
   *  a "changes requested" / "rejected" answer. */
  ended: z.object({
    kind: z.enum(["revoked", "superseded"]),
    by: z.string(),
    at: z.string(),
    reason: z.string().default(""),
  }),
});
export type PreviousSignoff = z.infer<typeof PreviousSignoffSchema>;

export const SignoffSchema = z.object({
  /** Who must sign off: a name, an address, or both ("Priya Nair (priya@x.com)"). */
  approver: z.string().nullable().default(null),
  /** When the person marked the request as sent (server clock) and who did. */
  requestedAt: z.string().nullable().default(null),
  requestedBy: z.string().nullable().default(null),
  /** What the request put in the to-do's "waiting on", so that recording the
   *  answer can clear it again (and only it). */
  waitingMarked: z.string().nullable().default(null),
  outcome: z.enum(SIGNOFF_OUTCOMES).default("pending"),
  /** The conditions, or the changes asked for, in the approver's words. */
  conditions: z.string().default(""),
  /** "Approved with conditions" completes the step only when a person confirms
   *  the conditions are met (server clock and OS user). */
  conditionsConfirmedAt: z.string().nullable().default(null),
  conditionsConfirmedBy: z.string().nullable().default(null),
  stamp: SignoffStampSchema.nullable().default(null),
  previous: z.array(PreviousSignoffSchema).default([]),
});
export type Signoff = z.infer<typeof SignoffSchema>;

export const CheckpointSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["step", "approval"]),
  state: z.enum(["pending", "done", "skipped"]),
  dueAt: isoDay.nullable().optional(),
  doneAt: z.string().nullable().optional(),
  /** Sign-off state; only meaningful on a `kind: "approval"` checkpoint. A record
   *  from before phase 6 has none (read as an empty sign-off). */
  signoff: SignoffSchema.optional(),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

export const TodoSourceSchema = z.object({
  /** null for a to-do typed in by hand. */
  intakeId: z.string().nullable(),
  source: z.enum(SOURCES),
  link: z.string().nullable(),
  subject: z.string(),
  sender: z.string().nullable(),
  receivedAt: z.string().nullable(),
  /** Conversation key of the source message (src/lib/pmo/thread.ts); a later
   *  message with the same key becomes an update to this to-do. */
  threadKey: z.string().nullable().default(null),
});
export type TodoSource = z.infer<typeof TodoSourceSchema>;

/** Per-to-do reminder state. Only `snoozedUntil` is read (src/lib/pmo/due.ts);
 *  `enabled`, `remindAt` and `lastRemindedAt` were reserved in phase 1 and are
 *  still ignored (what has been delivered lives in state/notify.json). */
export const RemindersSchema = z.object({
  enabled: z.boolean(),
  remindAt: z.string().nullable(),
  snoozedUntil: z.string().nullable(),
  lastRemindedAt: z.string().nullable(),
});
export type Reminders = z.infer<typeof RemindersSchema>;

export const HISTORY_KINDS = [
  "created",
  "message",
  "waiting",
  "due",
  "status",
  "chaser",
  "signoff",
] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

/** The to-do's timeline: the message it came from, linked follow-ups and the
 *  changes made by approved updates. Capped at MAX_HISTORY (the oldest entries
 *  after the first go). */
export const MAX_HISTORY = 60;
export const HistoryEntrySchema = z.object({
  id: z.string(),
  at: z.string(),
  kind: z.enum(HISTORY_KINDS),
  text: z.string(),
  /** A linked message, openable from the timeline (raw/<intakeId>.json). */
  intakeId: z.string().nullable().default(null),
  /** Who wrote that message. */
  from: z.string().nullable().default(null),
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const TodoStatusSchema = z.enum(["open", "done", "cancelled"]);
export type TodoStatus = z.infer<typeof TodoStatusSchema>;

/** todos/<id>.json. The "stage" is derived (todoLogic.deriveStage), never stored. */
export const TodoSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  owner: OwnerSchema,
  requester: RequesterSchema,
  dueAt: isoDay.nullable(),
  priority: z.enum(PRIORITIES),
  actionItems: z.array(ActionItemSchema),
  checkpoints: z.array(CheckpointSchema),
  status: TodoStatusSchema,
  waitingOn: z.string().nullable(),
  /** When "waiting on" was set; the chaser clock starts here. null on a to-do
   *  from before phase 4 (its last update is used instead). */
  waitingSince: z.string().nullable().default(null),
  /** Chase after this many quiet working days; null = the global default. */
  chaserDays: z.number().int().min(1).max(MAX_CHASER_DAYS).nullable().default(null),
  tags: z.array(z.string()),
  /** Ids of to-dos that must finish before this one can (dependencies). Older records have none. */
  blockedBy: z.array(z.string()).default([]),
  /** How often it repeats, as plain text ("weekly, before Tuesday"). Closing it creates the
   *  next round (or offers to, see Settings). null = a one-off. */
  recurrence: z.string().nullable().default(null),
  source: TodoSourceSchema,
  reminders: RemindersSchema,
  createdAt: z.string(),
  approvedAt: z.string(),
  approvedBy: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable().optional(),
  history: z.array(HistoryEntrySchema).default([]),
});
export type Todo = z.infer<typeof TodoSchema>;

// ---------------------------------------------------------------------------
// The model's structured output (one schema, sent to generateJson)
// ---------------------------------------------------------------------------

// Two layers of protection against a 7B model on CPU. (1) The JSON Schema sent
// to Ollama carries length/count limits (via .meta(), which adds keywords to
// the schema without adding validation), so constrained decoding physically
// cannot run on: an unbounded string or array is how a small model ends up
// generating until the timeout. (2) Anything that still overshoots is clamped
// by a transform instead of rejected, because a rejection costs a whole
// repair round-trip while trimming 210 characters to 200 costs nothing.
const clip = (max: number) =>
  z
    .string()
    .transform((value) => value.trim().slice(0, max))
    .meta({ maxLength: max });
const clipNullable = (max: number) =>
  z
    .string()
    .meta({ maxLength: max })
    .nullable()
    .transform((value) => {
      const text = value?.trim().slice(0, max);
      return text ? text : null;
    });
const dayOrNull = z
  .string()
  .meta({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })
  .nullable()
  .transform((value) => {
    return value && isRealIsoDay(value) ? value : null;
  });

export const AiOwnerSchema = z.object({
  name: clipNullable(120),
  email: clipNullable(200),
  isMe: z.boolean().nullable(),
});

// Property order matters: constrained decoding emits keys in this order, so
// `recurrence` comes before `dueAt` (the model decides "does this repeat?"
// before it picks a one-off date) and `quote` is last.
const aiActionItem = z.object({
  text: clip(200),
  owner: clipNullable(120),
  dueAt: dayOrNull,
});

/** Everything the model has to answer (prompt version 3). `reason`,
 *  `confidence` and `tags` are no longer asked for: each cost output tokens
 *  (about 8 per second on this CPU) and nothing used them. See AiStructuredSchema
 *  for the stored shape. */
export const AiModelSchema = z.object({
  isActionable: z.boolean(),
  title: clip(90),
  description: clip(600),
  owner: AiOwnerSchema,
  requester: z.object({ name: clipNullable(120), email: clipNullable(200) }),
  recurrence: clipNullable(RECURRENCE_MAX),
  dueAt: dayOrNull,
  dueBasis: z.enum(["explicit", "inferred", "none"]),
  priority: z.enum(PRIORITIES),
  actionItems: z
    .array(aiActionItem)
    .transform((items) => items.filter((item) => item.text).slice(0, 6))
    .meta({ maxItems: 6 }),
  checkpointTemplate: z.enum(CHECKPOINT_TEMPLATE_IDS),
  waitingOn: clipNullable(200),
  // Bounded like the rest: left unbounded, the model occasionally ran on until
  // the 4-minute timeout. Bounded, it sometimes fills the limit instead of
  // stopping at the end of the sentence; groundQuote (quote.ts) trims that.
  quote: clip(300),
});
export type AiModelOutput = z.output<typeof AiModelSchema>;

/** Most separate to-dos one message may produce (prompt version 4). */
export const MAX_TASKS_PER_MESSAGE = 5;

/** What the model answers from prompt version 4: one entry per independently
 *  completable task in the message (a message with one task gets one entry).
 *  Each entry is the lean AiModelSchema. The array is capped, not rejected, when
 *  the model is over-eager; the worker's own clean-up (splitTasks.ts) decides
 *  which ones survive. */
export const AiModelTasksSchema = z.object({
  tasks: z
    .array(AiModelSchema)
    .min(1)
    .transform((tasks) => tasks.slice(0, MAX_TASKS_PER_MESSAGE + 2))
    .meta({ maxItems: MAX_TASKS_PER_MESSAGE + 2 }),
});

/** The stored shape of a model answer (proposal.draft / proposal.rawDraft).
 *  `reason`, `confidence` and `tags` have defaults so records written by
 *  prompt version 2 (which have them) and version 3 (which do not) both parse. */
export const AiStructuredSchema = z.object({
  /** Why it is or is not actionable. Prompt versions 1-2 only; "" afterwards. */
  reason: clip(200).default(""),
  isActionable: z.boolean(),
  // A rough self-estimate from a small model, prompt versions 1-2 only: not
  // calibrated and never shown. null when the model was not asked.
  confidence: z
    .number()
    .nullable()
    .transform((value) =>
      value === null
        ? null
        : Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)),
    )
    .default(null),
  title: clip(90),
  description: clip(600),
  owner: AiOwnerSchema,
  requester: z.object({ name: clipNullable(120), email: clipNullable(200) }),
  recurrence: clipNullable(RECURRENCE_MAX).default(null),
  dueAt: dayOrNull,
  dueBasis: z.enum(["explicit", "inferred", "none"]),
  priority: z.enum(PRIORITIES),
  actionItems: z
    .array(aiActionItem)
    .transform((items) => items.filter((item) => item.text).slice(0, 8))
    .meta({ maxItems: 8 }),
  checkpointTemplate: z.enum(CHECKPOINT_TEMPLATE_IDS),
  waitingOn: clipNullable(200),
  tags: z
    .array(z.string().meta({ maxLength: 30 }))
    .transform((tags) =>
      tags
        .map((tag) => tag.trim().slice(0, 30))
        .filter(Boolean)
        .slice(0, 5),
    )
    .meta({ maxItems: 5 })
    .default([]),
  quote: clip(300),
});
export type AiStructured = z.output<typeof AiStructuredSchema>;

// What the model says a new message changes about an EXISTING to-do (thread-
// aware intake). Small on purpose: the patch itself is built from these fields
// by code (updateLogic.ts), never by the model.
export const UPDATE_KINDS = [
  "unrelated",
  "reply",
  "new-info",
  "new-action",
  "due-change",
  "nothing",
] as const;
export type UpdateKind = (typeof UPDATE_KINDS)[number];

/** What a reply says about a sign-off the to-do is awaiting (phase 6). */
export const SIGNOFF_CLASSES = [
  "approved",
  "approved_with_conditions",
  "changes_requested",
  "rejected",
  "unclear",
  "not_a_signoff",
] as const;
export type SignoffClass = (typeof SIGNOFF_CLASSES)[number];

const aiUpdateCore = {
  reason: clip(200),
  kind: z.enum(UPDATE_KINDS),
  /** One sentence: what this message changes. */
  summary: clip(220),
  /** The message supplies what the to-do was waiting for. */
  clearsWaiting: z.boolean(),
  /** A new deadline the message states, else null. */
  newDueAt: dayOrNull,
  newActionItems: z
    .array(
      z.object({
        text: clip(200),
        owner: clipNullable(120),
        dueAt: dayOrNull,
      }),
    )
    .transform((items) => items.filter((item) => item.text).slice(0, 4))
    .meta({ maxItems: 4 }),
  /** New information worth keeping in the description, else null. */
  note: clipNullable(300),
  quote: clip(300),
};

/** What the model is asked for on an ordinary update (a to-do that is not
 *  awaiting a sign-off): exactly the fields above. */
export const AiUpdateModelSchema = z.object(aiUpdateCore);

/** What it is asked for when the to-do IS awaiting a sign-off: the same fields
 *  plus a small classification. The reason comes before the verdict, the quote
 *  last (constrained decoding emits keys in this order). */
export const AiUpdateSignoffModelSchema = z.object({
  ...aiUpdateCore,
  signoffReason: clip(200),
  signoff: z.enum(SIGNOFF_CLASSES),
  signoffQuote: clip(300),
});

/** The stored answer (proposal.update.result). The sign-off fields are optional
 *  so every earlier record still parses; `signoffQuoteVerified` and
 *  `signoffGuard` are added by the server, not by the model. */
export const AiUpdateSchema = z.object({
  ...aiUpdateCore,
  signoffReason: clip(200).optional(),
  signoff: z.enum(SIGNOFF_CLASSES).optional(),
  signoffQuote: clip(300).optional(),
  /** Is `signoffQuote` really a sentence of the message? */
  signoffQuoteVerified: z.boolean().optional(),
  /** Why the server lowered the model's classification, when it did. */
  signoffGuard: z.string().nullish(),
  /** The message carries wording aimed at the assistant (looksLikeInjection);
   *  set by the server, so the card opens with every suggestion unticked. */
  suspicious: z.boolean().optional(),
});
export type AiUpdate = z.output<typeof AiUpdateSchema>;

// ---------------------------------------------------------------------------
// Proposals (the review queue)
// ---------------------------------------------------------------------------

export const PROPOSAL_STATUSES = [
  "pending",
  "structuring",
  // One task of a multi-task message, written before its group is complete:
  // hidden and not approvable until the whole group flips to "ready".
  "splitting",
  "ready",
  "failed",
  "approved",
  "rejected",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const MAX_AI_ATTEMPTS = 3;

export const STRUCTURING_OUTCOMES = ["ok", "fallback"] as const;
export type StructuringOutcome = (typeof STRUCTURING_OUTCOMES)[number];

export const ProposalSchema = z.object({
  id: z.string(),
  intakeId: z.string(),
  status: z.enum(PROPOSAL_STATUSES),
  summary: IntakeSummarySchema,
  /** What the review form starts from: the model's output after the app's
   *  deterministic clean-up (sanitizeDraft.ts; `ai.adjustments` says what it
   *  changed). Never mutated afterwards; the person's changes are `edits`. */
  draft: AiStructuredSchema.nullable(),
  /** The model's output exactly as validated, before the clean-up. null on a
   *  proposal from before prompt version 3, or when nothing was changed it
   *  equals `draft`. */
  rawDraft: AiStructuredSchema.nullable().optional(),
  /** The user's staged edits; null until they change something. */
  edits: StoredTodoDraftSchema.nullable(),
  isActionable: z.boolean().nullable(),
  confidence: z.number().nullable(),
  /** Is `draft.quote` really in the message? false -> "check against original". */
  quoteVerified: z.boolean().nullable(),
  ai: z.object({
    model: z.string().nullable(),
    durationMs: z.number().nullable(),
    attempts: z.number(),
    error: z.string().nullable().optional(),
    /** Plain-language notes on what the app's clean-up changed in the model's
     *  answer ("Priority lowered from high to normal ..."). Shown quietly in the
     *  review dialog. Absent or empty = nothing changed. */
    adjustments: z.array(z.string()).optional(),
  }),
  todoId: z.string().nullable().optional(),
  /** The message was longer than the intake limit and only its start was kept. */
  messageShortened: z.boolean().nullish(),
  /** The message was longer than the model reads at once: it saw the start and the
   *  end only. The card says "Long message: the AI read the start and the end only". */
  modelReadPartOnly: z.boolean().optional(),
  /** The sender's real text was under the quoted chain (bottom-posted or inline
   *  reply), so it was kept; the card says the request may be below the quote. */
  replyBelowQuote: z.boolean().optional(),
  /** Set when one message held several independent tasks: this proposal is the
   *  `index`-th (1-based) of `total` made from the same intake. Absent on a
   *  message that produced a single to-do. */
  part: z
    .object({ index: z.number().int().min(1), total: z.number().int().min(2) })
    .nullish(),
  /** Id of an earlier proposal from the same message that this one looks like
   *  but is not identical to; the card shows "Possible duplicate". */
  possibleDuplicateOf: z.string().nullish(),
  /** Set when the message belongs to the thread of an open to-do: this is an
   *  "update to existing to-do" card, not a new proposal. `draft` stays null. */
  update: z
    .object({
      todoId: z.string(),
      todoTitle: z.string(),
      threadKey: z.string(),
      result: AiUpdateSchema.nullable(),
    })
    .nullish(),
  /** Was the model's answer usable as it came? "fallback" = its title or
   *  description was unusable (a greeting, a bare name) and the app put its own in
   *  (sanitizeDraft.ts): the card says "AI could not structure this". Absent on a
   *  proposal from before this field = "ok". */
  structuring: z.enum(STRUCTURING_OUTCOMES).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const DEFAULT_RETENTION_DAYS = 90;
export const MIN_RETENTION_DAYS = 7;
export const MAX_RETENTION_DAYS = 3650;

const stringList = (fallback: string[]) => z.array(z.string()).default(fallback);

// --- reminder preferences (src/lib/pmo/due.ts reads these) ----------------------

export const DEFAULT_TIME_ZONE = TIME_ZONE_DEFAULT;
export const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5]; // Mon-Fri; 0 = Sunday

const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00.");

export const ReminderPrefsSchema = z.object({
  /** Master switch: off means no reminder is ever produced. */
  enabled: z.boolean().default(true),
  timeZone: z.string().default(DEFAULT_TIME_ZONE),
  workStart: clockTime.default("09:00"),
  workEnd: clockTime.default("18:00"),
  /** 0 = Sunday ... 6 = Saturday. */
  workDays: z.array(z.number().int().min(0).max(6)).default(DEFAULT_WORK_DAYS),
  /** Hold reminders until working hours instead of firing at night/weekends. */
  quietOutsideHours: z.boolean().default(true),
  /** The advance reminder lands this many working days before the due day; 0 = none. */
  leadWorkingDays: z.number().int().min(0).max(MAX_LEAD_WORKING_DAYS).default(1),
  /** A to-do with "waiting on" set and untouched this many working days gets a chaser. */
  chaserDays: z.number().int().min(1).max(MAX_CHASER_DAYS).default(DEFAULT_CHASER_DAYS),
  /** One 09:00 summary of the open items. */
  digest: z.boolean().default(false),
  /** Privacy: a notification says only "N items need attention", never a title. */
  hideDetails: z.boolean().default(true),
  /** Desktop app only: closing the window hides it to the tray so reminders keep firing. */
  keepRunningInTray: z.boolean().default(false),
});
export type ReminderPrefs = z.output<typeof ReminderPrefsSchema>;

export const defaultReminderPrefs = (): ReminderPrefs => ReminderPrefsSchema.parse({});

// --- weekly report (src/lib/pmo/report.ts reads these) ------------------------------

export const DEFAULT_REPORT_TITLE = "Weekly status";
export const MAX_REPORT_TITLE_CHARS = 80;

export const ReportPrefsSchema = z.object({
  /** The report's heading. */
  title: z.string().default(DEFAULT_REPORT_TITLE),
  /** Shown before the title ("Project Atlas: Weekly status"); blank = none. */
  projectName: z.string().default(""),
});
export type ReportPrefs = z.output<typeof ReportPrefsSchema>;

export const defaultReportPrefs = (): ReportPrefs => ReportPrefsSchema.parse({});

// Production defaults are neutral: nobody's name, domains or folder. The first-run
// wizard (firstRun.ts) fills them in; developerDefaults.ts holds the fixtures tests use.
export const PmoConfigSchema = z.object({
  /** Empty = not configured: nothing is ingested until the person picks a folder. */
  inboxDir: z.string().default(""),
  /** The first-run wizard finished. Nothing is ingested before this is true. */
  setupComplete: z.boolean().default(false),
  /** The person's own time zone, chosen in the wizard (reminders.timeZone follows it). */
  timeZone: z.string().default(DEFAULT_TIME_ZONE),
  /** Teams is default-deny: an item passes only if its tenant or chat is listed. */
  allowedTenantIds: stringList([]),
  teamsChatAllowlist: stringList([]),
  /** Empty = not configured (an Outlook message is then filtered, never taken in). */
  allowedSenderDomains: stringList([]),
  blockedDomains: stringList([]),
  blockedTerms: stringList([]),
  me: z
    .object({
      names: stringList([]),
      emails: stringList([]),
    })
    .default({ names: [], emails: [] }),
  /** Logs, and the raw text of closed to-dos and rejected proposals, are
   *  deleted after this many days (server/retention.ts). Open to-dos keep theirs. */
  retentionDays: z.number().int().default(DEFAULT_RETENTION_DAYS),
  /** Reminder engine preferences. A bad hand-edit falls back to the defaults
   *  for this block only, never for the whole config. */
  reminders: ReminderPrefsSchema.catch(() => defaultReminderPrefs()).default(() =>
    defaultReminderPrefs(),
  ),
  /** Weekly report heading; the same fall-back-per-block rule as `reminders`. */
  report: ReportPrefsSchema.catch(() => defaultReportPrefs()).default(() =>
    defaultReportPrefs(),
  ),
});
export type PmoConfig = z.output<typeof PmoConfigSchema>;

// Strict checks for what a person types in Settings. They apply to a PUT only:
// reading config.json stays lenient (a hand-edited file must never stop ingest).
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LIST = 200;

export const isDomainName = (value: string) => checkDomain(value).ok;
export const isEmailAddress = (value: string) => checkEmail(value).ok;

const listOf = (item: z.ZodType<string>) =>
  z.array(item).max(MAX_LIST, "At most 200 entries.");
const trimmed = (max: number) => z.string().trim().max(max, `At most ${max} characters.`);
const tenantId = trimmed(64).refine((v) => v === "" || GUID.test(v), {
  message: "Not a tenant ID (a GUID such as 00000000-0000-0000-0000-000000000000).",
});
const checkedEntry = (max: number, check: (value: string) => Checked) =>
  trimmed(max).superRefine((value, ctx) => {
    const result = value === "" ? null : check(value);
    if (result && !result.ok) ctx.addIssue({ code: "custom", message: result.reason });
  });
/** One domain per entry; blank is allowed (the lists drop it), anything else
 *  must pass `checkDomain`, with its reason as the message. */
export const DomainEntrySchema = checkedEntry(253, checkDomain);
export const EmailEntrySchema = checkedEntry(254, checkEmail);

/** The Settings form always sends the whole reminders block, so this one is
 *  strict and complete rather than partial. */
export const ReminderPrefsEditSchema = z
  .object({
    enabled: z.boolean(),
    timeZone: trimmed(64).refine(isValidTimeZone, {
      message: "Not a time zone name (for example Asia/Kolkata).",
    }),
    workStart: clockTime,
    workEnd: clockTime,
    workDays: z
      .array(z.number().int().min(0).max(6))
      .min(1, "Pick at least one working day.")
      .max(7),
    quietOutsideHours: z.boolean(),
    leadWorkingDays: z
      .number("Enter a number of working days.")
      .int("Whole days only.")
      .min(0, "At least 0 working days.")
      .max(MAX_LEAD_WORKING_DAYS, `At most ${MAX_LEAD_WORKING_DAYS} working days.`),
    chaserDays: z
      .number("Enter a number of working days.")
      .int("Whole days only.")
      .min(1, "At least 1 working day.")
      .max(MAX_CHASER_DAYS, `At most ${MAX_CHASER_DAYS} working days.`),
    digest: z.boolean(),
    hideDetails: z.boolean(),
    keepRunningInTray: z.boolean(),
  })
  .refine((value) => value.workStart < value.workEnd, {
    path: ["workEnd"],
    message: "Working hours must end after they start.",
  });

/** The Settings form always sends the whole report block. */
export const ReportPrefsEditSchema = z.object({
  title: trimmed(MAX_REPORT_TITLE_CHARS).refine((v) => v !== "", {
    message: "Enter a title for the report.",
  }),
  projectName: trimmed(MAX_REPORT_TITLE_CHARS),
});

/** What PUT /api/pmo/config may change (the inbox path stays file/env only).
 *  Spelled out rather than `.partial()` of the schema above: a defaulted
 *  field would silently reset to its default whenever a patch omits it. The
 *  Settings dialog runs the same schema, so errors appear inline before
 *  anything is sent. Blank entries are allowed here and dropped on save. */
export const PmoConfigPatchSchema = z.object({
  allowedTenantIds: listOf(tenantId).optional(),
  teamsChatAllowlist: listOf(trimmed(300)).optional(),
  allowedSenderDomains: listOf(DomainEntrySchema).optional(),
  blockedDomains: listOf(DomainEntrySchema).optional(),
  blockedTerms: listOf(trimmed(200)).optional(),
  me: z
    .object({
      names: listOf(trimmed(120)).min(1, "Add at least one name."),
      emails: listOf(EmailEntrySchema),
    })
    .optional(),
  retentionDays: z
    .number("Enter a number of days.")
    .int("Whole days only.")
    .min(MIN_RETENTION_DAYS, `At least ${MIN_RETENTION_DAYS} days.`)
    .max(MAX_RETENTION_DAYS, `At most ${MAX_RETENTION_DAYS} days.`)
    .optional(),
  reminders: ReminderPrefsEditSchema.optional(),
  report: ReportPrefsEditSchema.optional(),
});
export type PmoConfigPatch = z.infer<typeof PmoConfigPatchSchema>;

// ---------------------------------------------------------------------------
// GET /api/pmo/state
// ---------------------------------------------------------------------------

export interface IngestStatus {
  /** The folder being polled (env override applied). */
  inboxDir: string;
  /** false until the first-run wizard is finished and an inbox is chosen: the scanner is idle. */
  configured: boolean;
  inboxExists: boolean;
  scanIntervalMs: number;
  lastScanAt: string | null;
  /** Problems from the last scan (folder missing, a file that errored, ...). */
  errors: string[];
  lastScan: {
    ingested: number;
    duplicates: number;
    filtered: number;
    rejected: number;
  } | null;
  /** All quarantined items on disk. */
  filteredCount: number;
  /** Producer files parked in rejected-files/. */
  rejectedFileCount: number;
  /** No allowed tenant or chat yet, so every Teams item is being filtered. */
  teamsFiltering: boolean;
}

export interface RuntimeSummary {
  /** `asleep` (not in memory, loads on demand) is the normal idle state; `loading`
   *  is the model waking up for a call; `working` is a call running; `ready` is
   *  loaded and idle until `unloadsAt`. */
  state:
    | "asleep"
    | "loading"
    | "working"
    | "ready"
    | "down"
    | "model-missing"
    | "stub"
    | "unknown";
  model: string | null;
  message: string | null;
  /** Task kind the model is working on (`structure`, `chaser`, ...), while it is. */
  task?: string | null;
  /** When the loaded model is unloaded if nothing else asks (ISO). */
  unloadsAt?: string | null;
  /** Calls ahead of a structuring call that is waiting its turn in the model
   *  queue (the running call counts). Absent when nothing is ahead. */
  waitingBehind?: number;
}

export interface StructuringInfo {
  active: string | null;
  position: number;
  total: number;
  waiting: number;
  paused: {
    code: "runtime-down" | "model-missing";
    message: string;
    since: string;
  } | null;
}

/** A "draft a chaser" request and its result (server/chaser.ts). In memory
 *  only; the text is local, copy-only, and never sent by this app. */
export interface ChaserJob {
  id: string;
  todoId: string;
  status: "drafting" | "ready" | "failed";
  startedAt: string;
  finishedAt: string | null;
  /** The reviewable message body (plain text). */
  text: string | null;
  /** Suggested subject for a mail window. */
  subject: string | null;
  /** A recipient found in the original message that matches "waiting on". */
  to: string | null;
  error: string | null;
  model: string | null;
}

/** A "write highlights with AI" request for the weekly report (server/reportDrafts.ts).
 *  In memory only; the lines are text to review and add to the report, never sent. */
export interface ReportNarrativeJob {
  id: string;
  /** `<startDay>_<endDay>` of the period it was drafted for. */
  key: string;
  status: "drafting" | "ready" | "failed";
  startedAt: string;
  finishedAt: string | null;
  /** Verified lines per part (names, titles and dates all exist in the report's data). */
  narrative: {
    highlights: string[];
    risks: string[];
    nextWeek: string[];
  } | null;
  /** Model lines dropped because they named something that is not in the data. */
  removed: { part: string; line: string; reason: string }[];
  error: string | null;
  model: string | null;
  promptVersion: number;
}

/** Everything that needs a person's attention beyond the reminder badge. One
 *  strip in the UI reads this (see attentionView.ts). Each `*Names` list
 *  holds at most MAX_ATTENTION_NAMES entries. */
export interface AttentionSummary {
  /** Record files moved to <data>/corrupt/ because they could not be read. */
  corruptRecords: number;
  /** Inbox files over the size limit that could not be taken in. */
  oversizedFiles: number;
  /** Inbox files the last scan could not read (locked, permission, ...). */
  erroredFiles: number;
  /** Producer files parked in rejected-files/ after failing validation. */
  parkedFiles: number;
  queuePaused: boolean;
  modelMissing: boolean;
  /** Names of the quarantined record files (`<kind>/<file>`), newest last. */
  corruptFileNames: string[];
  oversizedFileNames: string[];
  erroredFileNames: string[];
  parkedFileNames: string[];
  /** Files in the inbox folder that are not PMO messages (other JSON, any
   *  non-JSON file). Left exactly where they are; only counted. */
  foreignFiles: number;
  foreignFileNames: string[];
  /** Exact repeats of an already-seen message dropped since the app started. */
  duplicatesIgnored: number;
  /** `reminders.timeZone` in config.json is not a real zone: the default is in use. */
  badTimeZone: boolean;
}

export const MAX_ATTENTION_NAMES = 20;

export const emptyAttentionSummary = (): AttentionSummary => ({
  corruptRecords: 0,
  oversizedFiles: 0,
  erroredFiles: 0,
  parkedFiles: 0,
  queuePaused: false,
  modelMissing: false,
  corruptFileNames: [],
  oversizedFileNames: [],
  erroredFileNames: [],
  parkedFileNames: [],
  foreignFiles: 0,
  foreignFileNames: [],
  duplicatesIgnored: 0,
  badTimeZone: false,
});

export interface PmoState {
  ok: true;
  serverTime: string;
  /** Today in the reminder time zone (IST by default), YYYY-MM-DD, so "overdue" agrees with the model's dates. */
  today: string;
  queue: Proposal[];
  /** Rejected proposals still on disk (newest first, capped): what Restore lists. */
  rejected: Proposal[];
  todos: Todo[];
  /** What needs a look right now (the dock badge number), per the reminder prefs. */
  attention: Attention;
  /** Unreadable records, unreadable or held-back files and paused work. */
  needsAttention: AttentionSummary;
  filtered: QuarantineRecord[];
  ingest: IngestStatus;
  structuring: StructuringInfo;
  runtime: RuntimeSummary;
  config: PmoConfig;
  dataDir: string;
  /** Chaser drafts in flight or finished, by to-do id. */
  chasers: Record<string, ChaserJob>;
  /** AI-improved sign-off request texts in flight or finished, by to-do id. The
   *  deterministic template needs no job (the dialog builds it itself). */
  signoffDrafts: Record<string, ChaserJob>;
}
