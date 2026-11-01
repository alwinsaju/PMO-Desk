// The Run dialog's checklist and file-type icons. Pure.
import { shortLabel } from "./stillNeeded.ts";
import type { TaskInputDef } from "./types.ts";

export type FileKind = "spreadsheet" | "document" | "data" | "file";

const KINDS: Record<string, FileKind> = {
  xlsx: "spreadsheet",
  xlsm: "spreadsheet",
  xls: "spreadsheet",
  csv: "spreadsheet",
  pdf: "document",
  doc: "document",
  docx: "document",
  txt: "document",
  json: "data",
  xml: "data",
};

/** The kind of file for a name or an accepted extension (".xlsx"). */
export function fileKind(nameOrExtension: string | undefined): FileKind {
  const ext = (nameOrExtension ?? "").split(".").pop()?.toLowerCase() ?? "";
  return KINDS[ext] ?? "file";
}

/** The kind an input expects, from its first accepted extension. */
export function inputKind(input: Pick<TaskInputDef, "accept">): FileKind {
  return fileKind(input.accept?.[0]);
}

export interface ChecklistItem {
  label: string;
  done: boolean;
}

/** One line per required input: ticked unless `missing` (from missingRequired) still names it. */
export function requirementChecklist(
  inputs: readonly Pick<TaskInputDef, "label" | "required">[],
  missing: readonly string[],
): ChecklistItem[] {
  return inputs
    .filter((input) => input.required)
    .map((input) => ({
      label: shortLabel(input.label),
      done: !missing.includes(input.label),
    }));
}
