// A plain line diff for comparing an earlier version of a template with the current one. Pure.
import type { Template, TemplateVersion } from "./types.ts";

export type DiffKind = "same" | "add" | "del";

export interface DiffLine {
  kind: DiffKind;
  text: string;
}

const lines = (text: string): string[] => (text === "" ? [] : text.split(/\r?\n/));

/** The lines that turn `before` into `after`: shared lines as "same", lines only in `before` as
 *  "del" and lines only in `after` as "add". Shortest edit by longest common subsequence. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = lines(before);
  const b = lines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  // table[i][j] = length of the common run of midA[i..] and midB[j..]
  const table = Array.from({ length: midA.length + 1 }, () =>
    new Array<number>(midB.length + 1).fill(0),
  );
  for (let i = midA.length - 1; i >= 0; i--) {
    for (let j = midB.length - 1; j >= 0; j--) {
      table[i][j] =
        midA[i] === midB[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const out: DiffLine[] = a.slice(0, start).map((text) => ({ kind: "same", text }));
  let i = 0;
  let j = 0;
  while (i < midA.length || j < midB.length) {
    if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
      out.push({ kind: "same", text: midA[i] });
      i++;
      j++;
    } else if (
      j >= midB.length ||
      (i < midA.length && table[i + 1][j] >= table[i][j + 1])
    ) {
      out.push({ kind: "del", text: midA[i++] });
    } else {
      out.push({ kind: "add", text: midB[j++] });
    }
  }
  for (const text of a.slice(endA)) out.push({ kind: "same", text });
  return out;
}

export function diffStats(diff: readonly DiffLine[]): { added: number; removed: number } {
  return {
    added: diff.filter((l) => l.kind === "add").length,
    removed: diff.filter((l) => l.kind === "del").length,
  };
}

export type DiffRow = DiffLine | { kind: "skip"; count: number };

/** Folds long runs of unchanged lines into one "skip" row, keeping `context` lines beside a change. */
export function collapseSame(diff: readonly DiffLine[], context = 2): DiffRow[] {
  const near = diff.map((line, i) => {
    if (line.kind !== "same") return true;
    return diff
      .slice(Math.max(0, i - context), i + context + 1)
      .some((other) => other.kind !== "same");
  });
  const out: DiffRow[] = [];
  let hidden = 0;
  diff.forEach((line, i) => {
    if (near[i]) {
      if (hidden) out.push({ kind: "skip", count: hidden });
      hidden = 0;
      out.push(line);
    } else hidden++;
  });
  if (hidden) out.push({ kind: "skip", count: hidden });
  return out;
}

export const VERSION_FIELDS = [
  ["name", "Name"],
  ["description", "Description"],
  ["subject", "Subject"],
  ["to", "To"],
  ["cc", "Cc"],
  ["body", "Message"],
] as const;

export type VersionField = (typeof VERSION_FIELDS)[number][0];

export interface FieldChange {
  field: VersionField;
  label: string;
  diff: DiffLine[];
}

/** What changed from `version` to the template as it is now, field by field (only fields that differ). */
export function versionChanges(
  current: Pick<Template, VersionField>,
  version: Pick<TemplateVersion, VersionField>,
): FieldChange[] {
  return VERSION_FIELDS.filter(([field]) => current[field] !== version[field]).map(
    ([field, label]) => ({
      field,
      label,
      diff: lineDiff(version[field], current[field]),
    }),
  );
}
