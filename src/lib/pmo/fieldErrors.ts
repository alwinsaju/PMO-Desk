// Turns a failed zod check of a request body into the per-entry list the
// routes answer with ({ field, index?, value, reason }), so a client can show
// each mistake next to the entry that caused it.
import type { z } from "zod";

export interface FieldError {
  /** The body field, e.g. "allowedSenderDomains" or "me.emails". */
  field: string;
  /** Position inside a list field. */
  index?: number;
  /** What was submitted (shortened); empty when it was not text. */
  value: string;
  reason: string;
}

const MAX_ERRORS = 50;
const MAX_VALUE_CHARS = 80;

function valueAt(body: unknown, path: readonly PropertyKey[]): string {
  let node: unknown = body;
  for (const key of path) {
    if (typeof node !== "object" || node === null) return "";
    node = (node as Record<PropertyKey, unknown>)[key];
  }
  if (typeof node !== "string") return "";
  return node.length > MAX_VALUE_CHARS ? `${node.slice(0, MAX_VALUE_CHARS)}...` : node;
}

export function fieldErrors(error: z.ZodError, body: unknown): FieldError[] {
  return error.issues.slice(0, MAX_ERRORS).map((issue) => {
    const last = issue.path[issue.path.length - 1];
    const indexed = typeof last === "number";
    const names = indexed ? issue.path.slice(0, -1) : issue.path;
    return {
      field: names.join("."),
      ...(indexed ? { index: last } : {}),
      value: valueAt(body, issue.path),
      reason: issue.message,
    };
  });
}

/** HTTP status for a route reply: 400 for a refusal that lists invalid entries,
 *  200 for every other business outcome (the repo's envelope convention). */
export function replyStatus(result: object): 200 | 400 {
  const listsErrors =
    "ok" in result &&
    result.ok === false &&
    "errors" in result &&
    Array.isArray(result.errors);
  return listsErrors ? 400 : 200;
}

/** One line for a refusal: the first problem, with its field and entry. */
export function summarizeFieldErrors(errors: readonly FieldError[]): string {
  const [first] = errors;
  if (!first) return "";
  const where = first.field ? `${first.field}: ` : "";
  const what = first.value ? `"${first.value}": ` : "";
  const more = errors.length > 1 ? ` (and ${errors.length - 1} more)` : "";
  return `${where}${what}${first.reason}${more}`;
}
