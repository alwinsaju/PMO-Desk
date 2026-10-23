/**
 * Pure logic for the form gate ("Answer questions"): which answer each
 * field currently shows, what is still unanswered, what Save must send, and
 * the grouping/filtering that keeps a ~20 field form usable. Type-only
 * imports so taskPlatform.test.mjs runs it under plain Node.
 *
 * The backend's `pending` counts required fields with no non-empty SAVED
 * answer, so a preselected default is still pending until it is saved. Save
 * therefore sends every shown value that differs from what is saved —
 * including untouched defaults — which is what lets "everything preselected"
 * be confirmed with a single Save.
 */
import type { FormAnswers, FormField, FormSchema } from "./types";

/** A value is only valid for a select if it is one of the field's options. */
function validFor(field: FormField, value: string | undefined): string {
  if (!value) return "";
  if (field.type === "select" && field.options) {
    return field.options.some((option) => option.value === value) ? value : "";
  }
  return value;
}

/** What each field shows: the user's edit, else the saved answer, else the
 *  schema default, else empty. Values that aren't valid options are
 *  dropped rather than shown as a phantom selection. */
export function effectiveAnswers(
  schema: FormSchema,
  saved: FormAnswers,
  edits: FormAnswers,
): FormAnswers {
  const out: FormAnswers = {};
  for (const field of schema.fields) {
    out[field.id] =
      validFor(field, edits[field.id]) ||
      validFor(field, saved[field.id]) ||
      validFor(field, field.default);
  }
  return out;
}

/** Ids of required fields whose shown value is empty. */
export function localPending(schema: FormSchema, effective: FormAnswers): string[] {
  return schema.fields
    .filter((field) => field.required && !effective[field.id])
    .map((field) => field.id);
}

/** The answers Save must POST: every non-empty shown value that differs from
 *  the saved one (the backend merges per key, so nothing else is sent). */
export function answersToSave(
  schema: FormSchema,
  saved: FormAnswers,
  effective: FormAnswers,
): FormAnswers {
  const out: FormAnswers = {};
  for (const field of schema.fields) {
    const value = effective[field.id];
    if (value && value !== saved[field.id]) out[field.id] = value;
  }
  return out;
}

/** True once the user has actually changed something that isn't saved —
 *  what the dialog's close-guard keys off (unsaved defaults don't count). */
export function hasUserEdits(
  schema: FormSchema,
  saved: FormAnswers,
  edits: FormAnswers,
): boolean {
  return schema.fields.some((field) => {
    const edit = validFor(field, edits[field.id]);
    return edit !== "" && edit !== saved[field.id];
  });
}

export interface FieldGroup {
  group: string;
  fields: FormField[];
}

/** Fields grouped by `group`, groups in order of first appearance. */
export function groupFields(fields: FormField[]): FieldGroup[] {
  const order: string[] = [];
  const byGroup = new Map<string, FormField[]>();
  for (const field of fields) {
    const group = field.group || "Other";
    if (!byGroup.has(group)) {
      byGroup.set(group, []);
      order.push(group);
    }
    byGroup.get(group)!.push(field);
  }
  return order.map((group) => ({ group, fields: byGroup.get(group)! }));
}

export interface FieldFilter {
  query: string;
  /** Only fields that are required and still empty. */
  onlyPending: boolean;
}

/** Search across label/description/group/id (all terms must match) and
 *  optionally restrict to unanswered required fields. */
export function filterFields(
  fields: FormField[],
  filter: FieldFilter,
  effective: FormAnswers,
): FormField[] {
  const terms = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  return fields.filter((field) => {
    if (filter.onlyPending && !(field.required && !effective[field.id])) return false;
    if (terms.length === 0) return true;
    const haystack = [field.label, field.description, field.group, field.id]
      .map((value) => value ?? "")
      .join(" ")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** Card-level one-liner from the backend's own pending list. */
export function formSummary(schema: FormSchema, pending: string[]): string {
  const required = schema.fields.filter((field) => field.required).length;
  if (pending.length === 0) {
    return required === 0
      ? "No required questions"
      : `All ${required} required question${required === 1 ? "" : "s"} answered`;
  }
  return `${pending.length} of ${required} required question${required === 1 ? "" : "s"} still need an answer`;
}
