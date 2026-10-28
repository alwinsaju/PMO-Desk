/**
 * Pure logic for the form gate ("Answer questions"): which answer each
 * field currently shows, what is still unanswered, what Save must send, and
 * the grouping/filtering that keeps a ~20 field form usable. Type-only
 * imports so taskPlatform.test.mjs runs it under plain Node.
 *
 * The engine's `pending` counts REQUIRED fields with no non-empty SAVED
 * answer (a text answer is trimmed first, so whitespace is not an answer),
 * so a preselected required default is still pending until it is saved.
 * Save therefore sends every shown required value that differs from what is
 * saved - including untouched defaults - which is what lets "everything
 * preselected" be confirmed with a single Save. Optional fields never pend:
 * an untouched optional default (e.g. an availability row left at "No
 * exception") is NOT sent, because the task script applies the schema
 * default itself; an optional field the user changed IS sent, and a text
 * field the user emptied is sent as `null` (the engine then drops the
 * saved answer).
 */
import type { FormAnswerPatch, FormAnswers, FormField, FormSchema } from "./types";

/** The engine's cap on a text answer (after trimming). */
export const TEXT_MAX_CHARS = 500;

/** Free-text fields: anything that is not a select (the panel renders an
 *  input box for every non-select type). */
export function isTextField(field: FormField): boolean {
  return field.type !== "select";
}

/** What the engine would store and count for this field's value. */
function normalized(field: FormField, value: string | undefined | null): string {
  const text = value ?? "";
  return isTextField(field) ? text.trim() : text;
}

/** True when `value` counts as an answer (non-empty; text is trimmed). */
export function isAnswered(field: FormField, value: string | undefined | null): boolean {
  return normalized(field, value) !== "";
}

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
 *  dropped rather than shown as a phantom selection. A text field the user
 *  emptied stays empty (the edit wins over the saved answer), which is what
 *  lets a saved value be cleared. */
export function effectiveAnswers(
  schema: FormSchema,
  saved: FormAnswers,
  edits: FormAnswers,
): FormAnswers {
  const out: FormAnswers = {};
  for (const field of schema.fields) {
    if (isTextField(field) && typeof edits[field.id] === "string") {
      out[field.id] = edits[field.id];
      continue;
    }
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
    .filter((field) => field.required && !isAnswered(field, effective[field.id]))
    .map((field) => field.id);
}

/** The answers Save must POST (the engine merges per key, so nothing else
 *  is sent): every non-empty shown value that differs from the saved one,
 *  and `null` for a text field the user emptied that has a saved answer.
 *  With `edits` given, an optional field the user never touched and that
 *  has nothing saved (a pure schema default) is left out; without it every
 *  differing value is sent. */
export function answersToSave(
  schema: FormSchema,
  saved: FormAnswers,
  effective: FormAnswers,
  edits?: FormAnswers,
): FormAnswerPatch {
  const out: FormAnswerPatch = {};
  for (const field of schema.fields) {
    const value = normalized(field, effective[field.id]);
    const before = normalized(field, saved[field.id]);
    if (value === before) continue;
    if (value === "") {
      if (isTextField(field) && before !== "") out[field.id] = null;
      continue;
    }
    const untouchedDefault =
      edits !== undefined &&
      !field.required &&
      saved[field.id] === undefined &&
      edits[field.id] === undefined;
    if (!untouchedDefault) out[field.id] = value;
  }
  return out;
}

/** True when the user changed this field and the change isn't saved yet. */
export function isEdited(
  field: FormField,
  edit: string | undefined,
  savedValue: string | undefined,
): boolean {
  if (edit === undefined) return false;
  if (isTextField(field))
    return normalized(field, edit) !== normalized(field, savedValue);
  const shown = validFor(field, edit);
  return shown !== "" && shown !== savedValue;
}

/** True once the user has actually changed something that isn't saved -
 *  what the dialog's close-guard keys off (unsaved defaults don't count). */
export function hasUserEdits(
  schema: FormSchema,
  saved: FormAnswers,
  edits: FormAnswers,
): boolean {
  return schema.fields.some((field) => isEdited(field, edits[field.id], saved[field.id]));
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isCalendarDate(text: string): Date | null {
  const m = DATE.exec(text);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d
    ? date
    : null;
}

/** A field that asks for dates says so in its description ("YYYY-MM-DD, ...").
 *  Returns a short, NON-blocking hint when the typed text does not look like
 *  a date list the task scripts accept (comma, semicolon or newline
 *  separated `YYYY-MM-DD` dates or `YYYY-MM-DD..YYYY-MM-DD` ranges), else
 *  null. The script does the real validation (including the window). */
export function dateFormatHint(
  field: FormField,
  value: string | undefined,
): string | null {
  if (!isTextField(field) || !/YYYY-MM-DD/i.test(field.description ?? "")) return null;
  const text = (value ?? "").trim();
  if (!text) return null;
  const bad = text
    .split(/[,;\n]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .some((token) => {
      const [first, last, ...rest] = token.split("..");
      if (rest.length > 0) return true;
      const a = isCalendarDate(first);
      if (!a) return true;
      if (last === undefined) return false;
      const b = isCalendarDate(last);
      return !b || b < a;
    });
  return bad
    ? "Check the dates: use YYYY-MM-DD, separated by commas (a range like 2026-12-28..2026-12-30 works too)."
    : null;
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
    if (
      filter.onlyPending &&
      !(field.required && !isAnswered(field, effective[field.id]))
    ) {
      return false;
    }
    if (terms.length === 0) return true;
    const haystack = [field.label, field.description, field.group, field.id]
      .map((value) => value ?? "")
      .join(" ")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** The one sentence the card and the dialog both show for the open count. */
export function requiredQuestionsText(pending: number, total: number): string {
  if (pending === 0) {
    return total === 0
      ? "No required questions"
      : `All ${total} required question${total === 1 ? "" : "s"} answered`;
  }
  return `${pending} of ${total} required question${total === 1 ? "" : "s"} still need an answer`;
}

/** The engine's pending ids minus those the person has just answered but not
 *  saved. Preselected defaults stay pending (as the engine counts them), so
 *  the card and the dialog show the same number. */
export function gatePending(
  schema: FormSchema,
  enginePending: string[],
  edits: FormAnswers,
): string[] {
  return enginePending.filter((id) => {
    const field = schema.fields.find((f) => f.id === id);
    return !field || !isAnswered(field, validFor(field, edits[id]));
  });
}

/** Card-level one-liner from the engine's own pending list. */
export function formSummary(schema: FormSchema, pending: string[]): string {
  const required = schema.fields.filter((field) => field.required).length;
  return requiredQuestionsText(pending.length, required);
}
