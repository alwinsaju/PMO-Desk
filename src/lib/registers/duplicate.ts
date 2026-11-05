// Duplicating a register record. The copy is a brand-new record: it carries only the field values.
// It never carries the id, the created and updated times, or the `todoId`. A copied `todoId` would
// make the copy look as if its to-do was already made, which switches off alerts that depend on it
// (the governance "time to start prep" alert) and stops "Make a to-do" from being offered.
import { todayIso } from "../staff/dates.ts";
import {
  MAX_TEXT,
  type FieldValue,
  type RegisterDef,
  type RegisterRecord,
} from "./types.ts";

const COPY_SUFFIX = " (copy)";

/**
 * The values of the copy: every field as it is, the title marked "(copy)", counters of to-dos made
 * back to 0, and the "created or opened on" date (`def.createdKey`) set to `today` (default: the
 * machine's own today) so the copy does not start out already days old. Other dates (due, review,
 * target...) stay as they were.
 */
export function duplicateValues(
  def: RegisterDef,
  record: Pick<RegisterRecord, "values">,
  today: string = todayIso(),
): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};
  for (const field of def.fields) {
    const value = record.values[field.key];
    if (value !== undefined)
      values[field.key] = Array.isArray(value) ? [...value] : value;
  }
  const title = values[def.titleKey];
  if (typeof title === "string" && title !== "") {
    values[def.titleKey] =
      `${title.slice(0, MAX_TEXT - COPY_SUFFIX.length)}${COPY_SUFFIX}`;
  }
  if (
    def.createdKey &&
    def.fields.some((f) => f.key === def.createdKey && f.type === "date")
  ) {
    values[def.createdKey] = today;
  }
  // The minutes' count of to-dos made belongs to the original's notes, not the copy.
  if (def.extras === "minutes" && "actions" in values) values.actions = 0;
  return values;
}
