// Making to-dos from several register records at once (late RAID items). Pure: the real to-do
// creation and the saving of each record's to-do id are passed in, so the rules are tested with
// fakes. A record that already has a `todoId` is never given a second to-do.
import { formatDate, formatDayMonth, isIsoDate, todayIso } from "../staff/dates.ts";
import { recordAlert, type AlertContext } from "./alerts.ts";
import { isOpen, recordTitle } from "./records.ts";
import { todoSeed, type TodoSeed } from "./reports.ts";
import type { RegisterDef, RegisterRecord } from "./types.ts";

/** Tools that offer to-dos in bulk: the RAID log, where a review date can pass. */
export function canBulkTodos(def: RegisterDef): boolean {
  return def.rule === "raid";
}

/** A record a to-do can still be made from: open, and no to-do made yet. */
export function needsTodo(def: RegisterDef, record: RegisterRecord): boolean {
  return isOpen(def, record) && !record.todoId;
}

/** The open records that are late and have no to-do yet. A record with no review date is never late. */
export function lateWithoutTodo(
  def: RegisterDef,
  items: readonly RegisterRecord[],
  ctx: AlertContext,
): RegisterRecord[] {
  return items.filter(
    (record) => needsTodo(def, record) && recordAlert(def, record, ctx)?.level === "late",
  );
}

/** Splits the chosen ids into the records to-dos can be made from and how many are skipped (closed, or a to-do already made). Ids no longer in the list are ignored. */
export function splitSelection(
  def: RegisterDef,
  items: readonly RegisterRecord[],
  selected: ReadonlySet<string>,
): { eligible: RegisterRecord[]; skipped: number } {
  const chosen = items.filter((record) => selected.has(record.id));
  const eligible = chosen.filter((record) => needsTodo(def, record));
  return { eligible, skipped: chosen.length - eligible.length };
}

export interface BulkTodoOps {
  make: (
    seed: TodoSeed,
    record: RegisterRecord,
  ) => Promise<{ ok: true; todoId: string } | { ok: false; reason: string }>;
  /** Saves the to-do id on the record. */
  link: (
    record: RegisterRecord,
    todoId: string,
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
}

export interface BulkTodoResult {
  /** Records that now have a to-do and the id saved on them. */
  made: { record: RegisterRecord; todoId: string }[];
  /** Why it stopped, when it did; the records after this one were not touched. */
  stopped: { record: RegisterRecord; reason: string; todoMade: boolean } | null;
  /** How many records were left alone because of that. */
  notDone: number;
}

/**
 * Makes a to-do for each record one after another and saves its id on the record before moving
 * to the next, so a stop part-way never leaves a made to-do unrecorded (except when saving the id
 * itself fails, which is reported as such). It stops at the first failure: the same fault would
 * most likely repeat. A record that already has a to-do is skipped.
 */
export async function makeTodosFor(
  def: RegisterDef,
  records: readonly RegisterRecord[],
  ops: BulkTodoOps,
): Promise<BulkTodoResult> {
  const result: BulkTodoResult = { made: [], stopped: null, notDone: 0 };
  const todo = records.filter((record) => needsTodo(def, record));
  for (let i = 0; i < todo.length; i += 1) {
    const record = todo[i]!;
    const created = await ops.make(todoSeed(def, record), record);
    if (!created.ok) {
      result.stopped = { record, reason: created.reason, todoMade: false };
    } else {
      const linked = await ops.link(record, created.todoId);
      if (linked.ok) {
        result.made.push({ record, todoId: created.todoId });
        continue;
      }
      result.stopped = { record, reason: linked.reason, todoMade: true };
    }
    result.notDone = todo.length - i - 1;
    return result;
  }
  return result;
}

/** A date the way the rest of the Toolkit says it: "20 Oct", with the year ("20 Oct 2027") when it is not in this year. Anything that is not a date is left as typed. */
function shortDate(iso: string, today: string): string {
  if (!isIsoDate(iso)) return iso;
  return iso.slice(0, 4) === today.slice(0, 4) ? formatDayMonth(iso) : formatDate(iso);
}

/** One line per record for the confirmation: its title and who and when it is for. `today` (yyyy-mm-dd, default the machine's today) decides whether the year is shown. */
export function confirmLine(
  def: RegisterDef,
  record: RegisterRecord,
  today: string = todayIso(),
): string {
  const owner = def.ownerKey ? String(record.values[def.ownerKey] ?? "") : "";
  const due = def.dueKey ? String(record.values[def.dueKey] ?? "") : "";
  return [
    recordTitle(def, record),
    owner && `owner ${owner}`,
    due && `review ${shortDate(due, today)}`,
  ]
    .filter(Boolean)
    .join(", ");
}
