/**
 * Shapes returned by the Tasks engine (see `tasks-engine/main.py`). Kept intentionally
 * narrow: only the fields this app actually renders are declared, and
 * anything the engine treats as an open-ended per-task manifest (step
 * ids/types) stays typed as plain strings rather than a guessed-at union.
 */

/**
 * The task state machine's states, exactly as returned by `Task.to_dict()`
 * in main.py — resting -> working -> (awaiting_review ->)? (awaiting_send
 * ->)? finishing -> back to resting, or error at any point. There is no
 * separate "done" state: a completed run just returns the task to
 * "resting" (see `_finish_task`).
 */
export type TaskState =
  "resting" | "working" | "awaiting_review" | "awaiting_send" | "finishing" | "error";

/** The kind of human gate a `review`/`confirm` step carries (platform
 *  contract section 1). Absent or "none" = the legacy bare gate. */
export type GateType = "form" | "flags" | "diff" | "none";

/** A step's `gate` block: the type plus the task-relative file names the
 *  engine reads for it (this app only ever uses the type — the file
 *  contents arrive through the dedicated endpoints). */
export interface StepGate {
  type: GateType | (string & {});
  schema?: string;
  answers?: string;
  file?: string;
}

export interface TaskStep {
  id: string;
  /** "python" | "powershell" | "review" | "confirm" in every task seen so
   *  far, but the engine never validates this against a closed set until
   *  a step actually runs — treated here as an opaque per-task manifest
   *  value. Only "review" and "confirm" are ever treated specially (as a
   *  human-attention gate); everything else renders as a normal step. */
  type: string;
  /** Optional UI text from the manifest (platform contract); the UI falls
   *  back to a humanized `id` when absent, which is what the four older
   *  tasks do. */
  label?: string | null;
  gate?: StepGate | null;
}

/** A start-form input declared by a task's manifest (contract section 1). */
export interface TaskInputDef {
  id: string;
  label: string;
  /** "file" = upload; "select" = options come from the prepare script. */
  type: "file" | "select" | (string & {});
  accept?: string[];
  dest?: string;
  required?: boolean;
  optionsFile?: string;
  optionsKey?: string;
  /** A file kept on disk across runs (e.g. the yearly Holiday Roster): once
   *  it is present the user need not upload it again. Absent on an older
   *  engine (= false). */
  persist?: boolean;
}

/** Task-level input cleanup policy from the manifest. `onComplete` = input
 *  files are removed automatically when a run completes; `keep` names what
 *  stays. Null/absent = the task never cleans up on its own. */
export interface TaskCleanup {
  onComplete: boolean;
  keep: string[];
}

/** `prepare` as exposed by GET /tasks is a bool; the raw manifest shape
 *  (an object naming the `after` inputs) is tolerated too. */
export type TaskPrepare = boolean | { cmd?: string; after?: string[] };

export interface TaskNotification {
  id: string;
  /** "task.review_ready" | "task.completed" | "task.failed" in practice. */
  kind: string;
  title: string;
  body: string;
  outputPath: string | null;
  /** Every file this notification offers an Open button for (report-data's
   *  `workbook_path` first, then its `extra_paths`); the paths are absolute
   *  and the only ones the engine will open. Absent on an older engine. */
  outputPaths?: OutputFile[];
  createdAt: string;
}

/** One openable output file of a notification. `label` names it when the
 *  task labelled it ("Analytics plan"); null for an unlabelled primary file. */
export interface OutputFile {
  label: string | null;
  path: string;
}

export interface Task {
  id: string;
  displayName: string;
  state: TaskState;
  error: string | null;
  currentStep: string | null;
  steps: TaskStep[];
  notifications: TaskNotification[];
  /** Declared only by tasks on the input/form platform; undefined for the
   *  four older tasks, which keep their one-click Run. */
  inputs?: TaskInputDef[];
  prepare?: TaskPrepare;
  cleanup?: TaskCleanup | null;
}

/** One past run record from GET /tasks/{id}/history, newest first. */
export interface HistoryRun {
  run_id: string;
  task_id: string;
  task_name: string | null;
  started_at: string;
  ended_at: string;
  outcome: "completed" | "failed" | string;
  current_step_at_end: string | null;
  error: string | null;
  steps_completed: string[];
  /** Who approved/confirmed what, stamped by the engine (OS user + UTC
   *  time, never client-supplied). Absent on records from an older engine. */
  approvals?: Approval[];
}

/** One approve/confirm recorded on a run. */
export interface Approval {
  step: string;
  kind: "approve" | "send" | (string & {});
  user: string;
  at: string;
}

/** One line of a task's live/most-recent per-step output, from
 *  GET /tasks/{id}/log. */
export interface LogEntry {
  step: string;
  /** "stdout" | "stderr" | "cmd" in practice. */
  stream: string;
  text: string;
}

/** Every POST action endpoint (start/approve/reject/send/reset, and
 *  notifications/{id}/open) replies with this same small shape — `ok:
 *  false` is a legitimate, non-exceptional response (e.g. "task is
 *  working"), not a thrown error. */
export interface ActionResult {
  ok: boolean;
  reason?: string;
  /** Approve's review-gate refusals: a count of incidents still needing a
   *  Subcategory2 (legacy review_incidents gate) or the ids of required
   *  form fields still unanswered (form gate). */
  pending?: number | string[];
  /** start's refusal: ids of required inputs that are missing. */
  missing?: string[];
  /** send's refusal at a diff gate: what is blocking the confirm. */
  blocking?: DiffBlocker[];
}

/** One incident awaiting human Subcategory2 classification, from
 *  GET /tasks/{id}/review-incidents. `resolved_subcategory2` is non-null
 *  once the human has picked a value this run (still editable until the
 *  gate is approved). */
export interface AiSuggestion {
  label: string;
  confidence: "high" | "medium" | "low";
  /** Evidence from past months (the closest similar ticket that used this label). */
  reason?: string;
  /** What the model understood the incident to be about, in its own words. */
  issue?: string;
  /** The label is not in the known vocabulary (the model proposed a new category). */
  is_new?: boolean;
  /** What the team usually chose for the most similar past tickets (when it differs). */
  vote_label?: string | null;
  vote_share?: number;
  model?: string;
}

export interface ReviewIncident {
  number: string;
  /** Incidents sharing this id have (almost) the same resolution notes. */
  notes_group?: string | null;
  /** The local AI model's suggested Subcategory2 (absent when AI was off or unavailable). */
  ai_suggestion?: AiSuggestion | null;
  short_description: string | null;
  resolution_notes: string | null;
  category: string | null;
  subcategory: string | null;
  state: string | null;
  assignment_group: string | null;
  assigned_to: string | null;
  current_subcategory2: string | null;
  review_reasons: string[];
  resolved_subcategory2: string | null;
}

/** The review queue for a task: the full option vocabulary plus the
 *  incidents and a live pending count the Approve gate keys off. */
export interface ReviewQueue {
  count: number;
  pending: number;
  options: string[];
  incidents: ReviewIncident[];
}

// ---------------------------------------------------------------------------
// Task platform contract (tasks/TASK-PLATFORM-CONTRACT.md): inputs,
// options, forms, flags, diffs. Every endpoint replies HTTP 200 with
// `{ok, reason?}`; the helpers in api.ts collapse HTTP/network failures into
// the same `{ok: false, reason}` shape so callers handle one failure path.
// ---------------------------------------------------------------------------

/** A reply from one of the platform endpoints: the contract's envelope plus
 *  that endpoint's own fields (all optional until `ok` is checked). */
export type Reply<T extends object = object> = {
  ok: boolean;
  reason?: string;
  /** Set by api.ts when the route doesn't exist (HTTP 404: an older engine
   *  still running), so a caller can hide a feature instead of showing a
   *  failure. Never sent by the engine itself. */
  notFound?: boolean;
} & Partial<T>;

/** One input's live status from GET /tasks/{id}/inputs. */
export interface InputStatus {
  id: string;
  label: string;
  type: string;
  required: boolean;
  present: boolean;
  filename?: string;
  size?: number;
  sha256?: string;
  /** Kept on disk across runs (see TaskInputDef.persist). */
  persist?: boolean;
  /** ISO UTC mtime of the file on disk; null/absent when unknown or missing. */
  modified?: string | null;
}

/** What "Clear input files" would delete right now. */
export interface Cleanable {
  files: number;
  bytes: number;
}

export interface InputsPayload {
  inputs: InputStatus[];
  /** Previously saved select values, `{inputId: value}`. */
  params: Record<string, string>;
  /** Input files on disk that a cleanup would remove. Absent on a engine
   *  without the cleanup feature. */
  cleanable?: Cleanable;
}

/** POST /tasks/{id}/cleanup: what was removed, and how many files could not
 *  be (e.g. open in another program). */
export interface CleanupPayload {
  removed: number;
  bytes: number;
  skipped: number;
}

export interface UploadPayload {
  input: string;
  filename: string;
  size: number;
  sha256: string;
}

/** One selectable entry in options.json's arrays (e.g. a roster cycle).
 *  Extra keys (start/end/coverage) pass through untouched. */
export interface OptionEntry {
  id: string;
  label: string;
  /** `false` = shown but not choosable; `reason` says why. */
  enabled?: boolean;
  reason?: string;
  coverage?: number;
  start?: string;
  end?: string;
}

export interface OptionsProblem {
  severity: string;
  message: string;
}

/** output/options.json, written by the task's `prepare` script. Arrays of
 *  OptionEntry sit under each select input's `optionsKey`, so the shape is
 *  open-ended apart from the two keys the UI also reads. */
export interface OptionsFile {
  roster?: Record<string, unknown>;
  default?: string;
  problems?: OptionsProblem[];
  [key: string]: unknown;
}

export interface OptionsPayload {
  options: OptionsFile | null;
  stderr_tail?: string;
}

/** One selectable answer in an ask-me field. */
export interface FormOption {
  value: string;
  label: string;
}

export interface FormField {
  id: string;
  group: string;
  label: string;
  description?: string;
  /** "select" (pick an option) or "text" (free text, trimmed, <= 500 chars). */
  type: "select" | "text" | (string & {});
  options?: FormOption[];
  default?: string;
  required?: boolean;
}

/** output/ask-me.json, the form gate's schema. */
export interface FormSchema {
  title?: string;
  fields: FormField[];
}

/** The flat answers file: `{fieldId: value}`. */
export type FormAnswers = Record<string, string>;

/** What Save POSTs: like the answers file, but `null` clears a saved answer. */
export type FormAnswerPatch = Record<string, string | null>;

export interface FormPayload {
  schema: FormSchema;
  answers: FormAnswers;
  /** Ids of required fields with no non-empty SAVED answer. */
  pending: string[];
}

export type FlagSeverity = "error" | "warning" | "info";

export interface Flag {
  key: string;
  severity: FlagSeverity | (string & {});
  kind: string;
  /** Null for roster-wide flags (e.g. STAFFING_SHORTAGE). */
  person: string | null;
  /** Null for flags with no single date (e.g. PTO_UNMATCHED). */
  date: string | null;
  team?: string | null;
  shift?: string | null;
  message: string;
}

/** output/flags.json. */
export interface FlagsFile {
  counts: Partial<Record<FlagSeverity, number>>;
  flags: Flag[];
}

export interface FlagsPayload {
  flags: FlagsFile | null;
}

/** Who the Outlook draft goes to, from GET /tasks/{id}/draft-summary. */
export interface DraftSummary {
  to: string[];
  cc: string[];
  subject: string;
  attachments: string[];
  /** Warnings the task wrote for the person to read before sending. Absent when there are none. */
  notes?: string[];
}

export interface DraftSummaryPayload {
  summary: DraftSummary | null;
}

export interface CellChange {
  person: string | null;
  date: string | null;
  before: string | null;
  after: string | null;
}

export interface DiffIssue {
  severity: string;
  kind: string;
  message: string;
}

export interface DiffBlocker {
  kind: string;
  message: string;
}

/** output/roster-diff.json. */
export interface RosterDiff {
  cycle?: string;
  changes: CellChange[];
  outside_changes?: CellChange[];
  issues?: DiffIssue[];
  /** Non-empty = the confirm is refused (and disabled here). */
  blocking?: DiffBlocker[];
  flags?: { new?: Flag[]; resolved?: Flag[]; remaining?: number };
}

export interface DiffPayload {
  diff: RosterDiff | null;
}
