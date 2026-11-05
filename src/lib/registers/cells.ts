// How a record's value reads in a register table (see registers.test.mjs). Pure.
import { formatDate, formatDayMonth } from "../staff/dates.ts";
import type { FieldDef, FieldValue } from "./types.ts";

/** "20 Oct", or "20 Oct 2027" when the date is not in the year of `today` (so 1 Jan 2000 is never read as this year). */
export function dateLabel(iso: string, today?: string): string {
  return today && iso.slice(0, 4) !== today.slice(0, 4)
    ? formatDate(iso)
    : formatDayMonth(iso);
}

/** The text for one cell; "" when the value is blank, so the table can show its dash. `today` adds the year to dates outside this year. */
export function cellText(
  field: FieldDef | undefined,
  value: FieldValue | undefined,
  today?: string,
): string {
  if (value === undefined || value === "") return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "✓" : "";
  if (field?.type === "date" && typeof value === "string") return dateLabel(value, today);
  if (field?.type === "url" && typeof value === "string") {
    try {
      const url = new URL(value);
      const path = url.pathname === "/" ? "" : url.pathname;
      const shown = `${url.hostname}${path}`;
      return shown.length > 60 ? `${shown.slice(0, 57)}…` : shown;
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
