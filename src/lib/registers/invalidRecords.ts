// Turning a record that fails the checks into something the Add/Edit form can open for repair, and
// a plain-text view of what the file holds. Pure.
import type { FieldValue, InvalidRecord, RegisterDef, RegisterRecord } from "./types.ts";

const isFieldValue = (v: unknown): v is FieldValue =>
  typeof v === "string" ||
  typeof v === "number" ||
  typeof v === "boolean" ||
  (Array.isArray(v) && v.every((t) => typeof t === "string"));

/** The record as the form can show it: every known field that holds a usable value, as it is in the file
 *  (the field that fails keeps its wrong value, so the form marks it). Null for an entry without a usable id. */
export function recordFromInvalid(
  def: RegisterDef,
  invalid: InvalidRecord,
): RegisterRecord | null {
  if (!invalid.id) return null;
  const raw =
    typeof invalid.raw === "object" && invalid.raw !== null
      ? (invalid.raw as Record<string, unknown>)
      : {};
  const source =
    typeof raw.values === "object" && raw.values !== null
      ? (raw.values as Record<string, unknown>)
      : {};
  const values: Record<string, FieldValue> = {};
  for (const field of def.fields) {
    const value = source[field.key];
    if (isFieldValue(value)) values[field.key] = value;
  }
  return {
    id: invalid.id,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
    values,
    ...(typeof raw.todoId === "string" ? { todoId: raw.todoId } : {}),
  };
}

/** The entry's content as readable lines ("Category: Procurement"), for looking at it before deciding. */
export function invalidLines(def: RegisterDef, invalid: InvalidRecord): string[] {
  const raw =
    typeof invalid.raw === "object" && invalid.raw !== null
      ? (invalid.raw as Record<string, unknown>)
      : null;
  if (!raw) return [String(invalid.raw)];
  const source =
    typeof raw.values === "object" && raw.values !== null
      ? (raw.values as Record<string, unknown>)
      : {};
  const lines = def.fields
    .filter((f) => source[f.key] !== undefined && source[f.key] !== "")
    .map((f) => {
      const v = source[f.key];
      const text = Array.isArray(v)
        ? v.join(", ")
        : typeof v === "string"
          ? v
          : JSON.stringify(v);
      return `${f.label}: ${text.length > 300 ? `${text.slice(0, 300)}…` : text}`;
    });
  return lines.length > 0 ? lines : [JSON.stringify(raw).slice(0, 300)];
}
