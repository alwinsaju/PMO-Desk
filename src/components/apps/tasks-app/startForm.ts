/**
 * Pure logic behind the Run form for tasks that declare `inputs`: which
 * files must exist before `prepare`, how a select input's choices come out
 * of options.json (disabled entries stay visible with their reason), what
 * the default is, when Start may be enabled, how a file kept on disk across
 * runs ("persist") reads, and the "Clear input files" rules. Imports are type-only so
 * taskPlatform.test.mjs runs it under plain Node.
 */
import { FILE_SIZE, formatBytes } from "../../../lib/format.ts";
import type {
  Cleanable,
  CleanupPayload,
  InputStatus,
  OptionEntry,
  OptionsFile,
  Task,
  TaskInputDef,
} from "./types";

/** Matches the engine's upload cap (contract section 2). */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export function fileInputs(task: Task): TaskInputDef[] {
  return (task.inputs ?? []).filter((input) => input.type === "file");
}

export function selectInputs(task: Task): TaskInputDef[] {
  return (task.inputs ?? []).filter((input) => input.type === "select");
}

/** True when the task has a `prepare` step to run. */
export function hasPrepare(task: Task): boolean {
  return Boolean(task.prepare);
}

/**
 * Ids of the inputs that must exist before `prepare` can run. GET /tasks
 * exposes `prepare` as a bool, so when the manifest's own `after` list isn't
 * visible this falls back to every required file input — which is exactly
 * the `after` list for shift-roster.
 */
export function prepareAfterIds(task: Task): string[] {
  if (typeof task.prepare === "object" && task.prepare && task.prepare.after) {
    return task.prepare.after;
  }
  return fileInputs(task)
    .filter((input) => input.required)
    .map((input) => input.id);
}

export function isPresent(statuses: InputStatus[], id: string): boolean {
  return statuses.some((status) => status.id === id && status.present);
}

/** All `prepare.after` inputs are on the engine, so "Check inputs" can run. */
export function canPrepare(task: Task, statuses: InputStatus[]): boolean {
  if (!hasPrepare(task)) return false;
  const after = prepareAfterIds(task);
  return after.length > 0 && after.every((id) => isPresent(statuses, id));
}

/** Client-side guard mirroring the engine's checks, so a bad file is
 *  refused with a readable message before the upload starts. The engine
 *  re-validates everything; this is only for fast feedback. */
export function validateFile(
  input: Pick<TaskInputDef, "accept" | "label">,
  file: { name: string; size: number },
): string | null {
  const accept = (input.accept ?? []).map((ext) => ext.toLowerCase());
  if (accept.length > 0) {
    const dot = file.name.lastIndexOf(".");
    const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
    if (!accept.includes(ext)) {
      return `${input.label} must be a ${accept.join(" / ")} file.`;
    }
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `${file.name} is ${formatBytes(file.size, FILE_SIZE)} — the limit is ${formatBytes(MAX_UPLOAD_BYTES, FILE_SIZE)}.`;
  }
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}

export interface SelectChoice {
  id: string;
  label: string;
  enabled: boolean;
  /** Why a disabled choice can't be picked (or a note on an enabled one). */
  reason?: string;
  coverage?: number;
}

/** The choices for a select input, read from the array named by its
 *  `optionsKey`. Entries without `enabled` count as enabled; disabled ones
 *  are kept so the UI can show them grayed with their reason. */
export function selectChoices(
  options: OptionsFile | null | undefined,
  optionsKey: string | undefined,
): SelectChoice[] {
  if (!options || !optionsKey) return [];
  const raw = options[optionsKey];
  if (!Array.isArray(raw)) return [];
  return (raw as OptionEntry[])
    .filter((entry) => entry && typeof entry.id === "string")
    .map((entry) => ({
      id: entry.id,
      label: entry.label || entry.id,
      enabled: entry.enabled !== false,
      reason: entry.reason || undefined,
      coverage: typeof entry.coverage === "number" ? entry.coverage : undefined,
    }));
}

/** The preselected choice: options.default when it is enabled, else the
 *  first enabled choice, else nothing (every choice disabled). */
export function defaultChoice(
  options: OptionsFile | null | undefined,
  choices: SelectChoice[],
): string | null {
  const wanted = options?.default;
  if (wanted && choices.some((c) => c.id === wanted && c.enabled)) return wanted;
  return choices.find((c) => c.enabled)?.id ?? null;
}

/** True if `value` is a choice that exists and is enabled. */
export function isChoosable(choices: SelectChoice[], value: string | undefined): boolean {
  return Boolean(value) && choices.some((c) => c.id === value && c.enabled);
}

/** Labels of required inputs still unsatisfied — empty means Start may be
 *  enabled. Files are satisfied by a present upload, selects by an enabled
 *  choice (which also implies `prepare` has been run). */
export function missingRequired(
  task: Task,
  statuses: InputStatus[],
  selections: Record<string, string>,
  choicesByInput: Record<string, SelectChoice[]>,
): string[] {
  const missing: string[] = [];
  for (const input of task.inputs ?? []) {
    if (!input.required) continue;
    if (input.type === "file") {
      if (!isPresent(statuses, input.id)) missing.push(input.label);
    } else if (input.type === "select") {
      if (!isChoosable(choicesByInput[input.id] ?? [], selections[input.id])) {
        missing.push(input.label);
      }
    }
  }
  return missing;
}

/** `accept` attribute value for a hidden file input. */
export function acceptAttr(input: Pick<TaskInputDef, "accept">): string | undefined {
  return input.accept && input.accept.length > 0 ? input.accept.join(",") : undefined;
}

// ---------------------------------------------------------------------------
// Files kept on disk across runs (`persist`), e.g. the yearly Holiday Roster.
// ---------------------------------------------------------------------------

/** True if the input is a file kept across runs. The live status from
 *  GET /inputs wins; the manifest's `persist` (GET /tasks) is the fallback. */
export function isPersistInput(
  input: Pick<TaskInputDef, "persist">,
  status?: Pick<InputStatus, "persist">,
): boolean {
  return Boolean(status?.persist ?? input.persist);
}

/** A persist input whose file is already on disk: shown as a compact "On
 *  file" row instead of a drop zone, and counted as satisfied for Start. */
export function isOnFile(
  input: Pick<TaskInputDef, "persist">,
  status?: Pick<InputStatus, "persist" | "present">,
): boolean {
  return Boolean(status?.present) && isPersistInput(input, status);
}

/** Helper line under an empty REQUIRED persist drop zone. */
export const PERSIST_HINT = "Upload once; it stays on file for future runs.";

/** Helper line under an empty OPTIONAL persist drop zone (a file the task can
 *  do without, e.g. the Holiday Roster, which falls back to a reference copy). */
export const OPTIONAL_PERSIST_HINT =
  "Not uploaded - a file kept from an earlier run or the built-in reference is used. If a run says it is missing, upload it here.";

/** True for a file input the task can run without. */
export function isOptionalFile(input: Pick<TaskInputDef, "required">): boolean {
  return !input.required;
}

/** The small hint under an empty drop zone, or null when there is none:
 *  a kept (persist) file says how it behaves; an optional one says what
 *  happens when it is left out. */
export function emptyFileHint(
  input: Pick<TaskInputDef, "persist" | "required">,
  status?: Pick<InputStatus, "persist">,
): string | null {
  if (!isPersistInput(input, status)) return null;
  return isOptionalFile(input) ? OPTIONAL_PERSIST_HINT : PERSIST_HINT;
}

/** True when uploading `input` makes an earlier Check stale: a file `prepare`
 *  waits for (`after`), or an optional kept file the check also reads (the
 *  Holiday Roster: the check says which Holiday Roster the run will use). */
export function uploadInvalidatesCheck(
  task: Task,
  input: Pick<TaskInputDef, "id" | "persist" | "required">,
): boolean {
  return (
    prepareAfterIds(task).includes(input.id) ||
    (isOptionalFile(input) && Boolean(input.persist))
  );
}

/** "2026-2027" for consecutive years, "2026" for one, "2026, 2028" otherwise. */
export function formatYears(years: number[]): string {
  const sorted = [...new Set(years)].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return String(sorted[0]);
  const consecutive = sorted.every((y, i) => i === 0 || y === sorted[i - 1] + 1);
  return consecutive ? `${sorted[0]}-${sorted[sorted.length - 1]}` : sorted.join(", ");
}

/** The quiet line under the Check area about which Holiday Roster the run
 *  will use, read from options.json's `holiday_source`; null when the task's
 *  options don't carry one (or it is malformed). */
export function holidaySourceLine(
  options: OptionsFile | null | undefined,
): string | null {
  const raw = options?.holiday_source;
  if (!raw || typeof raw !== "object") return null;
  const { kind, covers_years: years } = raw as { kind?: unknown; covers_years?: unknown };
  if (kind === "uploaded") return "Holiday Roster: uploaded file";
  if (kind !== "reference") return null;
  const covered = Array.isArray(years)
    ? years.filter((y): y is number => typeof y === "number" && Number.isFinite(y))
    : [];
  return covered.length > 0
    ? `Holiday Roster: reference file (covers ${formatYears(covered)})`
    : "Holiday Roster: reference file";
}

function parseIsoUtc(value: string): Date {
  // A naive ISO string (no Z / offset) would be read as LOCAL time.
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(value);
  return new Date(hasZone ? value : `${value}Z`);
}

/** "12 Mar 2026" for a file's ISO UTC mtime, in the viewer's time zone
 *  (override `locale`/`timeZone` for tests); null when absent or unreadable. */
export function formatUploaded(
  modified: string | null | undefined,
  options: { locale?: string; timeZone?: string } = {},
): string | null {
  if (!modified) return null;
  const date = parseIsoUtc(modified);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(options.locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: options.timeZone,
  });
}

/** True when the task cleans its non-kept input files after each run. */
export function cleansOnComplete(task: Pick<Task, "cleanup">): boolean {
  return Boolean(task.cleanup?.onComplete);
}

/** The calm footnote at the bottom of the start dialog; null for tasks that
 *  don't clean up. Mentions the exception only when something is kept. */
export function cleanupNote(task: Task): string | null {
  if (!cleansOnComplete(task)) return null;
  return keepsSomeInputs(task)
    ? "Input files are removed automatically after the run completes, except the ones kept on file."
    : "Input files are removed automatically after the run completes.";
}

/** Dialog subtitle: the check/choose steps are only mentioned when the task
 *  has them (the older file-only tasks just need their file). */
export function startDescription(task: Task): string {
  const steps =
    hasPrepare(task) || selectInputs(task).length > 0
      ? "Add the files, check them, then choose what to build."
      : fileInputs(task).length === 1
        ? "Add the file, then start the run."
        : "Add the files, then start the run.";
  return `${steps} Nothing runs until you press Start.`;
}

/** Live status after an upload completes (the reply carries no mtime, so
 *  `now` stands in for it). Works whether or not a status existed already. */
export function applyUpload(
  statuses: InputStatus[],
  input: TaskInputDef,
  uploaded: { filename?: string; size?: number },
  file: { name: string; size: number },
  now: Date = new Date(),
): InputStatus[] {
  const patch = {
    present: true,
    filename: uploaded.filename ?? file.name,
    size: uploaded.size ?? file.size,
    modified: now.toISOString(),
  };
  if (statuses.some((s) => s.id === input.id)) {
    return statuses.map((s) => (s.id === input.id ? { ...s, ...patch } : s));
  }
  return [
    ...statuses,
    {
      id: input.id,
      label: input.label,
      type: input.type,
      required: Boolean(input.required),
      persist: input.persist,
      ...patch,
    },
  ];
}

// ---------------------------------------------------------------------------
// "Clear input files": delete a resting task's input files on demand.
// ---------------------------------------------------------------------------

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Offered only while the task is resting (never while running/awaiting),
 *  for a task on the inputs platform, and only when there is something to
 *  delete. `cleanable` is undefined on a engine without the feature. */
export function canClearInputs(
  task: Pick<Task, "state" | "inputs">,
  cleanable: Cleanable | null | undefined,
): boolean {
  return (
    task.state === "resting" &&
    (task.inputs?.length ?? 0) > 0 &&
    Boolean(cleanable) &&
    (cleanable?.files ?? 0) > 0
  );
}

/** "Clear input files (3 files, 12.0 MB)". */
export function clearButtonLabel(cleanable: Cleanable): string {
  return `Clear input files (${plural(cleanable.files, "file")}, ${formatBytes(cleanable.bytes, FILE_SIZE)})`;
}

/** The confirmation sentence shown before anything is deleted. */
export function clearConfirmText(cleanable: Cleanable, keepsSome: boolean): string {
  return `Delete ${plural(cleanable.files, "input file")} (${formatBytes(cleanable.bytes, FILE_SIZE)}) from this computer? This can't be undone.${keepsSome ? " Files kept on file for future runs stay." : ""}`;
}

/** True when some of the task's inputs stay on disk across runs. */
export function keepsSomeInputs(task: Pick<Task, "cleanup" | "inputs">): boolean {
  return (
    (task.cleanup?.keep?.length ?? 0) > 0 ||
    (task.inputs ?? []).some((input) => input.persist)
  );
}

/** Result line after a cleanup: "Removed 3 files, freed 12.0 MB; 1 file
 *  skipped — it may be open in another program." */
export function cleanupResultText(result: Partial<CleanupPayload>): string {
  const removed = result.removed ?? 0;
  const skipped = result.skipped ?? 0;
  const head =
    removed > 0
      ? `Removed ${plural(removed, "file")}, freed ${formatBytes(result.bytes ?? 0, FILE_SIZE)}`
      : "No files were removed";
  if (skipped === 0) return `${head}.`;
  return `${head}; ${plural(skipped, "file")} skipped — ${skipped === 1 ? "it" : "they"} may be open in another program.`;
}
