// Pure parsing for ChipInput (see chipInputLogic.test.mjs): splitting typed or
// pasted text into values, de-duplicating, the max count and per-chip errors.
// Invalid values are kept as chips so the user can see and fix them.

export type ChipSeparator = "comma" | "semicolon" | "space" | "newline" | "tab";

/** Enter and blur always commit; these are the characters that commit while typing. */
export const DEFAULT_SEPARATORS: readonly ChipSeparator[] = [
  "comma",
  "semicolon",
  "space",
  "newline",
];

const SEPARATOR_CHARS: Record<ChipSeparator, string> = {
  comma: ",",
  semicolon: ";",
  space: " ",
  newline: "\r\n",
  tab: "\t",
};

function separatorChars(separators: readonly ChipSeparator[]): string {
  return separators.map((s) => SEPARATOR_CHARS[s]).join("");
}

function splitOn(text: string, chars: string): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const ch of text) {
    if (chars.includes(ch)) {
      pieces.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  pieces.push(current);
  return pieces;
}

/** Every non-empty, trimmed piece of `text` (a paste, or the draft on Enter/blur). */
export function splitChips(
  text: string,
  separators: readonly ChipSeparator[] = DEFAULT_SEPARATORS,
): string[] {
  return splitOn(text, separatorChars(separators))
    .map((piece) => piece.trim())
    .filter(Boolean);
}

/** While typing: commit the pieces before the last separator, keep the rest as the draft. */
export function consumeDraft(
  draft: string,
  separators: readonly ChipSeparator[] = DEFAULT_SEPARATORS,
): { tokens: string[]; rest: string } {
  const chars = separatorChars(separators);
  const pieces = splitOn(draft, chars);
  if (pieces.length === 1) return { tokens: [], rest: draft };
  const rest = pieces[pieces.length - 1] ?? "";
  const tokens = pieces
    .slice(0, -1)
    .map((piece) => piece.trim())
    .filter(Boolean);
  return { tokens, rest };
}

export interface AddChipsOptions {
  normalize?: (raw: string) => string;
  max?: number;
  caseSensitive?: boolean;
}

export interface AddChipsResult {
  values: string[];
  added: string[];
  duplicates: string[];
  /** Valid or not, tokens that did not fit under `max`. */
  overflow: string[];
}

export function addChips(
  current: readonly string[],
  tokens: readonly string[],
  { normalize, max, caseSensitive = false }: AddChipsOptions = {},
): AddChipsResult {
  const key = (value: string) => (caseSensitive ? value : value.toLowerCase());
  const seen = new Set(current.map(key));
  const values = [...current];
  const added: string[] = [];
  const duplicates: string[] = [];
  const overflow: string[] = [];

  for (const token of tokens) {
    const value = (normalize ? normalize(token.trim()) : token.trim()).trim();
    if (!value) continue;
    if (seen.has(key(value))) {
      duplicates.push(token.trim());
    } else if (max !== undefined && values.length >= max) {
      overflow.push(value);
    } else {
      seen.add(key(value));
      values.push(value);
      added.push(value);
    }
  }
  return { values, added, duplicates, overflow };
}

/** One error (or null) per chip, in order. */
export function chipErrors(
  values: readonly string[],
  validate: ((value: string) => string | null) | undefined,
): (string | null)[] {
  return values.map((value) => (validate ? validate(value) : null));
}

export function removeChip(values: readonly string[], index: number): string[] {
  return values.filter((_, i) => i !== index);
}

/** What to tell the user when some of what they typed or pasted was not added. */
export function addNotice(result: AddChipsResult, max?: number): string | null {
  const parts: string[] = [];
  if (result.duplicates.length) {
    parts.push(`Already added: ${result.duplicates.join(", ")}`);
  }
  if (result.overflow.length) {
    parts.push(`Only ${max} allowed, not added: ${result.overflow.join(", ")}`);
  }
  return parts.length ? parts.join(". ") : null;
}

/** "bad: Not an email address" per invalid chip, first `limit` then "and N more". */
export function chipErrorLines(
  values: readonly string[],
  errors: readonly (string | null)[],
  limit = 3,
): string[] {
  const lines = values.flatMap((value, i) => {
    const error = errors[i];
    return error ? [`${value}: ${error}`] : [];
  });
  if (lines.length <= limit) return lines;
  return [...lines.slice(0, limit), `and ${lines.length - limit} more`];
}
