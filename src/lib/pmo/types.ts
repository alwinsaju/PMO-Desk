// Shared data shapes for the PMO To-Do app (see ARCHITECTURE.md, "PMO To-Do").
// Pure: only imports zod, so both the server modules and the client UI can
// import it, and `pnpm test` can load it under plain Node.
import { z } from "zod";
import type { Attention } from "./due.ts";
import { isValidTimeZone } from "./time.ts";

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
  sourceId: z.string().trim().min(1),
  receivedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "receivedAt must be an ISO 8601 date-time",
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
const isoInstant = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Not an ISO 8601 date-time",
  });

export const DEFAULT_CHASER_DAYS = 2;
export const MAX_CHASER_DAYS = 30;

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

export const ActionItemDraftSchema = z.object({
  text: z.string().trim().min(1).max(200),
  owner: z.string().nullable(),
  dueAt: isoDay.nullable(),
});
export type ActionItemDraft = z.infer<typeof ActionItemDraftSchema>;

/** What the human reviews and approves; becomes a Todo. */
export const TodoDraftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(4000),
  owner: OwnerSchema,
  requester: RequesterSchema,
  dueAt: isoDay.nullable(),
  priority: z.enum(PRIORITIES),
  actionItems: z.array(ActionItemDraftSchema).max(30),
  checkpointTemplate: z.enum(CHECKPOINT_TEMPLATE_IDS),
  waitingOn: z.string().nullable(),
  /** When the waiting started; absent = the moment of approval. */
  waitingSince: isoInstant.nullable().optional(),
  tags: z.array(z.string()).max(10),
});
export type TodoDraft = z.infer<typeof TodoDraftSchema>;

export const ActionItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  done: z.boolean(),
  owner: z.string().nullable().optional(),
  dueAt: isoDay.nullable().optional(),
});
export type ActionItem = z.infer<typeof ActionItemSchema>;

export const CheckpointSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["step", "approval"]),
  state: z.enum(["pending", "done", "skipped"]),
  dueAt: isoDay.nullable().optional(),
  doneAt: z.string().nullable().optional(),
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
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? null : value;
  });

export const AiOwnerSchema = z.object({
  name: clipNullable(120),
  email: clipNullable(200),
  isMe: z.boolean().nullable(),
});

// Property order matters: constrained decoding emits keys in this order, so
// `reason` comes before the verdict it explains and `quote` is last.
export const AiStructuredSchema = z.object({
  reason: clip(200),
  isActionable: z.boolean(),
  // A rough self-estimate from a small model: kept in the schema and on the
  // proposal for the record, but the UI does not show it (it is not calibrated).
  confidence: z
    .number()
    .transform((value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))),
  title: clip(90),
  description: clip(600),
  owner: AiOwnerSchema,
  requester: z.object({ name: clipNullable(120), email: clipNullable(200) }),
  dueAt: dayOrNull,
  dueBasis: z.enum(["explicit", "inferred", "none"]),
  priority: z.enum(PRIORITIES),
  actionItems: z
    .array(
      z.object({
        text: clip(200),
        owner: clipNullable(120),
        dueAt: dayOrNull,
      }),
    )
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
    .meta({ maxItems: 5 }),
  // Bounded like the rest: left unbounded, the model occasionally ran on until
  // the 4-minute timeout. Bounded, it sometimes fills the limit instead of
  // stopping at the end of the sentence; groundQuote (quote.ts) trims that.
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

export const AiUpdateSchema = z.object({
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
});
export type AiUpdate = z.output<typeof AiUpdateSchema>;

// ---------------------------------------------------------------------------
// Proposals (the review queue)
// ---------------------------------------------------------------------------

export const PROPOSAL_STATUSES = [
  "pending",
  "structuring",
  "ready",
  "failed",
  "approved",
  "rejected",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const MAX_AI_ATTEMPTS = 3;

export const ProposalSchema = z.object({
  id: z.string(),
  intakeId: z.string(),
  status: z.enum(PROPOSAL_STATUSES),
  summary: IntakeSummarySchema,
  /** The model's output, exactly as validated. Never mutated afterwards. */
  draft: AiStructuredSchema.nullable(),
  /** The user's staged edits; null until they change something. */
  edits: TodoDraftSchema.nullable(),
  isActionable: z.boolean().nullable(),
  confidence: z.number().nullable(),
  /** Is `draft.quote` really in the message? false -> "check against original". */
  quoteVerified: z.boolean().nullable(),
  ai: z.object({
    model: z.string().nullable(),
    durationMs: z.number().nullable(),
    attempts: z.number(),
    error: z.string().nullable().optional(),
  }),
  todoId: z.string().nullable().optional(),
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
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const DEFAULT_INBOX_DIR = "C:\\Users\\alsaju\\OneDrive - Deloitte (O365D)\\PMO-Inbox";
/** Earlier defaults, which first run wrote into config.json; store.loadConfig
 *  migrates a saved value that is exactly one of these to DEFAULT_INBOX_DIR. */
export const LEGACY_DEFAULT_INBOX_DIRS = [
  "C:\\Users\\alsaju\\OneDrive - Deloitte\\PMO-Inbox",
];

export const DEFAULT_RETENTION_DAYS = 90;
export const MIN_RETENTION_DAYS = 7;
export const MAX_RETENTION_DAYS = 3650;

const stringList = (fallback: string[]) => z.array(z.string()).default(fallback);

// --- reminder preferences (src/lib/pmo/due.ts reads these) ----------------------

export const DEFAULT_TIME_ZONE = "Asia/Kolkata";
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

export const PmoConfigSchema = z.object({
  inboxDir: z.string().default(DEFAULT_INBOX_DIR),
  /** Teams is default-deny: an item passes only if its tenant or chat is listed. */
  allowedTenantIds: stringList([]),
  teamsChatAllowlist: stringList([]),
  allowedSenderDomains: stringList(["deloitte.com"]),
  blockedDomains: stringList(["takeda.com"]),
  blockedTerms: stringList([]),
  me: z
    .object({
      names: stringList(["Alwin Saju", "Saju", "Alwin"]),
      emails: stringList(["alsaju@deloitte.com"]),
    })
    .default({
      names: ["Alwin Saju", "Saju", "Alwin"],
      emails: ["alsaju@deloitte.com"],
    }),
  /** Logs, and the raw text of closed to-dos and rejected proposals, are
   *  deleted after this many days (server/retention.ts). Open to-dos keep theirs. */
  retentionDays: z.number().int().default(DEFAULT_RETENTION_DAYS),
  /** Reminder engine preferences. A bad hand-edit falls back to the defaults
   *  for this block only, never for the whole config. */
  reminders: ReminderPrefsSchema.catch(() => defaultReminderPrefs()).default(() =>
    defaultReminderPrefs(),
  ),
});
export type PmoConfig = z.output<typeof PmoConfigSchema>;

// Strict checks for what a person types in Settings. They apply to a PUT only:
// reading config.json stays lenient (a hand-edited file must never stop ingest).
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const EMAIL = /^[^\s@<>"']+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const MAX_LIST = 200;

const listOf = (item: z.ZodType<string>) =>
  z.array(item).max(MAX_LIST, "At most 200 entries.");
const trimmed = (max: number) => z.string().trim().max(max, `At most ${max} characters.`);
const tenantId = trimmed(64).refine((v) => v === "" || GUID.test(v), {
  message: "Not a tenant ID (a GUID such as 00000000-0000-0000-0000-000000000000).",
});
const domainEntry = trimmed(253).refine(
  (v) => v === "" || DOMAIN.test(v.replace(/^@/, "")),
  { message: "Not a domain name (for example example.com)." },
);
const emailEntry = trimmed(254).refine((v) => v === "" || EMAIL.test(v), {
  message: "Not an email address.",
});

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

/** What PUT /api/pmo/config may change (the inbox path stays file/env only).
 *  Spelled out rather than `.partial()` of the schema above: a defaulted
 *  field would silently reset to its default whenever a patch omits it. The
 *  Settings dialog runs the same schema, so errors appear inline before
 *  anything is sent. Blank entries are allowed here and dropped on save. */
export const PmoConfigPatchSchema = z.object({
  allowedTenantIds: listOf(tenantId).optional(),
  teamsChatAllowlist: listOf(trimmed(300)).optional(),
  allowedSenderDomains: listOf(domainEntry).optional(),
  blockedDomains: listOf(domainEntry).optional(),
  blockedTerms: listOf(trimmed(200)).optional(),
  me: z
    .object({
      names: listOf(trimmed(120)).min(1, "Add at least one name."),
      emails: listOf(emailEntry),
    })
    .optional(),
  retentionDays: z
    .number("Enter a number of days.")
    .int("Whole days only.")
    .min(MIN_RETENTION_DAYS, `At least ${MIN_RETENTION_DAYS} days.`)
    .max(MAX_RETENTION_DAYS, `At most ${MAX_RETENTION_DAYS} days.`)
    .optional(),
  reminders: ReminderPrefsEditSchema.optional(),
});
export type PmoConfigPatch = z.infer<typeof PmoConfigPatchSchema>;

// ---------------------------------------------------------------------------
// GET /api/pmo/state
// ---------------------------------------------------------------------------

export interface IngestStatus {
  /** The folder being polled (env override applied). */
  inboxDir: string;
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
  state: "ready" | "cold" | "down" | "model-missing" | "stub" | "unknown";
  model: string | null;
  message: string | null;
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

export interface PmoState {
  ok: true;
  serverTime: string;
  /** Today in IST, YYYY-MM-DD, so "overdue" agrees with the model's dates. */
  today: string;
  queue: Proposal[];
  todos: Todo[];
  /** What needs a look right now (the dock badge number), per the reminder prefs. */
  attention: Attention;
  filtered: QuarantineRecord[];
  ingest: IngestStatus;
  structuring: StructuringInfo;
  runtime: RuntimeSummary;
  config: PmoConfig;
  dataDir: string;
  /** Chaser drafts in flight or finished, by to-do id. */
  chasers: Record<string, ChaserJob>;
}
