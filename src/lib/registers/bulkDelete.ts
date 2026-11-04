// Deleting several register records at once, with one confirmation and one Undo. Pure: the real
// remove and save calls are passed in, so the rules are tested with fakes. The server takes at
// most 500 records per write, so a large selection goes in chunks; whatever was deleted before a
// failure is reported, so the Undo still covers it.
import { confirmLine } from "./bulkTodos.ts";
import { recordTitle } from "./records.ts";
import type { FieldValue, RegisterDef, RegisterRecord } from "./types.ts";

/** The most records the server accepts in one write. */
export const BULK_CHUNK = 500;

type Result = { ok: true } | { ok: false; reason: string };

export interface RecordBack {
  id: string;
  values: Record<string, FieldValue>;
  todoId?: string;
}

export interface BulkDeleteOps {
  remove: (ids: string[]) => Promise<Result>;
  save: (records: RecordBack[]) => Promise<Result>;
}

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += BULK_CHUNK)
    out.push(items.slice(i, i + BULK_CHUNK));
  return out;
}

/** The confirmation's lines, one per record. */
export function deleteLines(
  def: RegisterDef,
  records: readonly RegisterRecord[],
): string[] {
  return records.map((record) => confirmLine(def, record));
}

/** How many of the records have a to-do made from them (the to-do itself is not deleted). */
export function withTodoCount(records: readonly RegisterRecord[]): number {
  return records.filter((record) => !!record.todoId).length;
}

/** What Undo saves back for a record: its id, values and to-do link, as the per-record Undo does. */
export function recordBack(record: RegisterRecord): RecordBack {
  return { id: record.id, values: record.values, todoId: record.todoId };
}

export interface BulkDeleteResult {
  /** The records that are gone now (Undo puts exactly these back). */
  deleted: RegisterRecord[];
  /** Why it stopped, when it did; the records after that chunk were left alone. */
  failed: string | null;
}

/** Deletes the records chunk by chunk, stopping at the first failure. */
export async function bulkDelete(
  records: readonly RegisterRecord[],
  ops: BulkDeleteOps,
): Promise<BulkDeleteResult> {
  const result: BulkDeleteResult = { deleted: [], failed: null };
  for (const chunk of chunks(records)) {
    const reply = await ops.remove(chunk.map((record) => record.id));
    if (!reply.ok) {
      result.failed = reply.reason;
      return result;
    }
    result.deleted.push(...chunk);
  }
  return result;
}

/** Puts deleted records back, chunk by chunk. On a failure, says how many were put back. */
export async function bulkRestore(
  records: readonly RegisterRecord[],
  ops: Pick<BulkDeleteOps, "save">,
): Promise<{ ok: true } | { ok: false; reason: string; restored: number }> {
  let restored = 0;
  for (const chunk of chunks(records)) {
    const reply = await ops.save(chunk.map(recordBack));
    if (!reply.ok) return { ok: false, reason: reply.reason, restored };
    restored += chunk.length;
  }
  return { ok: true };
}

/** The toast after a delete: the title for one record, a count for several. */
export function deletedMessage(
  def: RegisterDef,
  deleted: readonly RegisterRecord[],
): string {
  if (deleted.length === 1) return `Deleted “${recordTitle(def, deleted[0]!)}”.`;
  return `Deleted ${deleted.length} records from ${def.title}.`;
}

/** The message when a delete stopped part-way. */
export function partialDeleteMessage(
  deleted: number,
  requested: number,
  reason: string,
): string {
  return `${reason} ${deleted} of ${requested} deleted; the rest were left as they were.`;
}
