// How long a field's text may be, and the "n of max characters" hint the form shows near the limit. Pure.
import { MAX_LONGTEXT, MAX_TEXT, MAX_URL, type FieldDef } from "./types.ts";

/** The most characters a field takes, or null when its type has no text limit. */
export function fieldLimit(field: FieldDef): number | null {
  if (field.type === "longtext") return MAX_LONGTEXT;
  if (field.type === "url") return MAX_URL;
  if (field.type === "text" || field.type === "person") return MAX_TEXT;
  return null;
}

/** "3,950 of 4,000 characters" once the text is within 10% of the limit (or over it); otherwise nothing. */
export function lengthHint(length: number, limit: number | null): string | undefined {
  if (limit === null || length < limit * 0.9) return undefined;
  return `${length.toLocaleString("en")} of ${limit.toLocaleString("en")} characters`;
}
