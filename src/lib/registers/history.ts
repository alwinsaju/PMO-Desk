// Local change history for register records (ops-3). Pure: shared by the server and the page.
//
// An append-only log of WHICH fields of a record changed and WHEN. It stores field keys only, never
// values or text (the same privacy stance as the model log). It lives in its own file per tool,
// `<data>/registers/history/<tool>.jsonl`, so it is never part of a record and never goes through
// the record re-validation on read. A local file cannot be made truly immutable, so this is
// "append-only", not tamper-proof.
import { RECORD_ID } from "./records.ts";
import type { FieldValue, RegisterDef, RegisterRecord } from "./types.ts";

export type HistoryKind = "created" | "changed" | "deleted";

export interface HistoryEntry {
  /** ISO time of the save. */
  at: string;
  /** The record the entry is about. */
  id: string;
  kind: HistoryKind;
  /** Field keys that changed (kind "changed" only). Keys, never values. */
  fields?: string[];
}

/** Newest entries kept per tool; older ones are dropped when the file is trimmed. */
export const HISTORY_MAX_ENTRIES = 2000;
/** The file is only rewritten (trimmed) once it grows past this many bytes. */
export const HISTORY_TRIM_BYTES = 400 * 1024;
/** Entries shown for one record. */
export const HISTORY_SHOWN = 50;

const FIELD_KEY = /^[A-Za-z0-9_]{1,40}$/;

const sameValue = (a: FieldValue | undefined, b: FieldValue | undefined): boolean => {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => x === b[i])
    );
  }
  // An unset field and an empty one are the same thing to the person.
  return (a ?? "") === (b ?? "");
};

/** The keys of the definition's fields whose value differs, in field order. */
export function changedFields(
  def: RegisterDef,
  before: Record<string, FieldValue>,
  after: Record<string, FieldValue>,
): string[] {
  return def.fields
    .filter((f) => !sameValue(before[f.key], after[f.key]))
    .map((f) => f.key);
}

/** The entry for saving `next` over `existing` (undefined = a new record); null when no field changed. */
export function entryForSave(
  def: RegisterDef,
  existing: RegisterRecord | undefined,
  next: RegisterRecord,
  at: string,
): HistoryEntry | null {
  if (!existing) return { at, id: next.id, kind: "created" };
  const fields = changedFields(def, existing.values, next.values);
  return fields.length > 0 ? { at, id: next.id, kind: "changed", fields } : null;
}

export const serializeEntries = (entries: readonly HistoryEntry[]): string =>
  entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "");

/** Entries from the file's text. A damaged or unknown line is skipped; nothing here ever throws. */
export function parseHistory(text: string): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof raw !== "object" || raw === null) continue;
    const e = raw as Record<string, unknown>;
    if (typeof e.at !== "string" || Number.isNaN(Date.parse(e.at))) continue;
    if (typeof e.id !== "string" || !RECORD_ID.test(e.id)) continue;
    if (e.kind !== "created" && e.kind !== "changed" && e.kind !== "deleted") continue;
    const fields = Array.isArray(e.fields)
      ? e.fields.filter((k): k is string => typeof k === "string" && FIELD_KEY.test(k))
      : [];
    out.push({
      at: e.at,
      id: e.id,
      kind: e.kind,
      ...(e.kind === "changed" && fields.length ? { fields: fields.slice(0, 60) } : {}),
    });
  }
  return out;
}

/** The newest `max` entries (the file order is oldest first). */
export const trimHistory = (
  entries: readonly HistoryEntry[],
  max = HISTORY_MAX_ENTRIES,
): HistoryEntry[] =>
  entries.length > max ? entries.slice(entries.length - max) : [...entries];

/** One record's entries, newest first. */
export function entriesFor(
  entries: readonly HistoryEntry[],
  id: string,
  max = HISTORY_SHOWN,
): HistoryEntry[] {
  return entries
    .filter((e) => e.id === id)
    .reverse()
    .slice(0, max);
}

/** Plain words for an entry: "Created", "Changed Status, Owner", "Deleted". Unknown keys show as is. */
export function describeEntry(def: RegisterDef, entry: HistoryEntry): string {
  if (entry.kind === "created") return "Created";
  if (entry.kind === "deleted") return "Deleted";
  const labels = (entry.fields ?? []).map(
    (key) => def.fields.find((f) => f.key === key)?.label ?? key,
  );
  return labels.length ? `Changed ${labels.join(", ")}` : "Changed";
}
