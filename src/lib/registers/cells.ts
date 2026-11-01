// How a record's value reads in a register table (see registers.test.mjs). Pure.
import { formatDayMonth } from "../staff/dates.ts";
import type { FieldDef, FieldValue } from "./types.ts";

/** The text for one cell; "" when the value is blank, so the table can show its dash. */
export function cellText(
  field: FieldDef | undefined,
  value: FieldValue | undefined,
): string {
  if (value === undefined || value === "") return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "✓" : "";
  if (field?.type === "date" && typeof value === "string") return formatDayMonth(value);
  if (field?.type === "url" && typeof value === "string") {
    try {
      return new URL(value).hostname;
    } catch {
      return value;
    }
  }
  const text = String(value);
  return text.length > 90 ? `${text.slice(0, 87)}…` : text;
}

/** Why Export CSV is off, or null when there is something to export. */
export function exportHint(totalCount: number, shownCount: number): string | null {
  if (shownCount > 0) return null;
  return totalCount === 0
    ? "Nothing to export yet"
    : "Nothing to export: no record matches the search or filter";
}
