// Several tasks in one message (prompt version 4). The model may answer one or
// more tasks; this is the deterministic part: normalise the answer, drop what is
// not a real extra task, and cap the count. Pure and client-safe, no I/O.
import { MAX_TASKS_PER_MESSAGE, type AiStructured } from "./types.ts";

export interface SplitResult<T> {
  kept: T[];
  /** Plain-language notes about tasks that were dropped or capped. */
  notes: string[];
}

/** The model's answer as a list: a bare single task (an older prompt, a stub or a
 *  test generator) is a list of one. Never empty for a non-empty answer. */
export function asTaskList<T>(answer: T | T[]): T[] {
  return Array.isArray(answer) ? answer : [answer];
}

const STOP = new Set(["a", "an", "the", "to", "for", "of", "and", "on", "in", "with", "by", "up", "about"]);

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w && !STOP.has(w));

const key = (text: string) => words(text).join(" ");

/** Share of the smaller title's words that the other title also has. */
function overlap(a: string, b: string): number {
  const wa = new Set(words(a));
  const wb = new Set(words(b));
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}

/** Two tasks that are really the same one: the same title (ignoring case,
 *  punctuation and filler words), mostly the same words, or the same quoted
 *  sentence with the same due date. */
export function isNearDuplicate(a: AiStructured, b: AiStructured): boolean {
  const ka = key(a.title);
  const kb = key(b.title);
  if (ka && ka === kb) return true;
  if (words(a.title).length >= 3 && words(b.title).length >= 3 && overlap(a.title, b.title) >= 0.8) {
    return true;
  }
  if (a.quote.trim() && a.quote.trim() === b.quote.trim() && a.dueAt === b.dueAt) {
    return key(a.title).length > 0 && overlap(a.title, b.title) >= 0.5;
  }
  return false;
}

/** An extra task whose whole title is only a step already listed under an
 *  earlier task: a sub-step the model over-split, not a separate to-do. */
function isStepOfEarlier(task: AiStructured, earlier: AiStructured[]): boolean {
  const k = key(task.title);
  if (!k) return false;
  return earlier.some((e) =>
    e.actionItems.some((item) => {
      const ki = key(item.text);
      return ki === k || (words(item.text).length >= 3 && overlap(item.text, task.title) >= 0.9);
    }),
  );
}

/**
 * Which of the model's tasks become proposals. The first actionable task always
 * survives; later ones are dropped when they are not actionable (an FYI listed
 * as a task), near-duplicates of a kept one, or only a step already listed under
 * a kept one; at most MAX_TASKS_PER_MESSAGE are kept. If nothing is actionable
 * the first entry alone is kept (the "not a task" card). `entries` is in the
 * model's order and `draftOf` reads the (cleaned) draft of an entry.
 */
export function selectTasks<T>(
  entries: T[],
  draftOf: (entry: T) => AiStructured,
  max = MAX_TASKS_PER_MESSAGE,
): SplitResult<T> {
  if (entries.length <= 1) return { kept: entries.slice(0, 1), notes: [] };
  const notes: string[] = [];
  const actionable = entries.filter((e) => draftOf(e).isActionable);
  if (actionable.length === 0) return { kept: [entries[0]], notes: [] };
  if (actionable.length < entries.length) {
    notes.push(
      `Ignored ${entries.length - actionable.length} item(s) the model listed that need no action.`,
    );
  }
  const kept: T[] = [];
  let duplicates = 0;
  let steps = 0;
  for (const entry of actionable) {
    const draft = draftOf(entry);
    const earlier = kept.map(draftOf);
    if (earlier.some((e) => isNearDuplicate(e, draft))) {
      duplicates++;
      continue;
    }
    if (isStepOfEarlier(draft, earlier)) {
      steps++;
      continue;
    }
    kept.push(entry);
  }
  if (duplicates > 0) notes.push(`Merged ${duplicates} near-identical task(s) from the same message.`);
  if (steps > 0) notes.push(`Folded ${steps} sub-step(s) into the task they belong to.`);
  if (kept.length > max) {
    notes.push(`Kept the first ${max} of ${kept.length} tasks found in this message.`);
    kept.length = max;
  }
  return { kept, notes };
}
