/**
 * Pure logic behind the Run form for tasks that declare `inputs`: which
 * files must exist before `prepare`, how a select input's choices come out
 * of options.json (disabled entries stay visible with their reason), what
 * the default is, and when Start may be enabled. Imports are type-only so
 * taskPlatform.test.mjs runs it under plain Node.
 */
import type { InputStatus, OptionEntry, OptionsFile, Task, TaskInputDef } from "./types";

/** Matches the backend's upload cap (contract section 2). */
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

/** All `prepare.after` inputs are on the backend, so "Check inputs" can run. */
export function canPrepare(task: Task, statuses: InputStatus[]): boolean {
  if (!hasPrepare(task)) return false;
  const after = prepareAfterIds(task);
  return after.length > 0 && after.every((id) => isPresent(statuses, id));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Client-side guard mirroring the backend's checks, so a bad file is
 *  refused with a readable message before the upload starts. The backend
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
    return `${file.name} is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`;
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
