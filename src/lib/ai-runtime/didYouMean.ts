// "Did you mean …?" for the command bar: a close spelling of a day or a task name, offered
// only when the corrected text really is understood. Pure.
import { KNOWN_TASKS, type KnownTask } from "../tasks-engine/catalog.ts";
import type { DateRange } from "./whenPhrase.ts";

/** Plain Levenshtein distance (insert, delete, replace). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/** Short words only tolerate one slip; longer ones two. */
const allowedSlips = (length: number): number => (length <= 4 ? 1 : 2);

/** The vocabulary word closest to `word`, or null if `word` is already one or nothing is near. */
export function closestWord(word: string, vocabulary: readonly string[]): string | null {
  const w = word.toLowerCase();
  if (w.length < 3 || vocabulary.includes(w)) return null;
  let best: { word: string; distance: number } | null = null;
  for (const candidate of vocabulary) {
    const distance = editDistance(w, candidate);
    if (
      distance <= allowedSlips(Math.max(w.length, 3)) &&
      (!best || distance < best.distance)
    ) {
      best = { word: candidate, distance };
    }
  }
  return best?.word ?? null;
}

const WHEN_WORDS: readonly string[] = [
  "today",
  "tomorrow",
  "yesterday",
  "this",
  "next",
  "last",
  "week",
  "weekend",
  "month",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "january",
  "february",
  "march",
  "april",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/**
 * A corrected spelling of a day phrase ("nxt mondy" -> "next monday"), or null when
 * nothing needs or can be fixed. `resolve` is the real parser: a guess it cannot read
 * is never offered.
 */
export function suggestWhen(
  phrase: string,
  today: string,
  resolve: (phrase: string, today: string) => DateRange | null,
): string | null {
  let changed = false;
  const fixed = phrase
    .trim()
    .split(/\s+/)
    .map((token) => {
      const near = /^[a-z]+$/i.test(token) ? closestWord(token, WHEN_WORDS) : null;
      if (near) changed = true;
      return near ?? token;
    })
    .join(" ");
  return changed && resolve(fixed, today) ? fixed : null;
}

const norm = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9&]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The task whose name is closest to what was typed ("agin report" -> Aging Report), or null. */
export function suggestTask(text: string): KnownTask | null {
  const words = norm(text).split(" ").filter(Boolean);
  let best: { task: KnownTask; distance: number } | null = null;
  for (const task of KNOWN_TASKS) {
    for (const alias of task.aliases) {
      const target = norm(alias);
      const size = target.split(" ").length;
      // Compare against every run of the same number of words in what was typed.
      for (let start = 0; start + size <= words.length; start++) {
        const candidate = words.slice(start, start + size).join(" ");
        const distance = editDistance(candidate, target);
        const limit = Math.max(1, Math.floor(target.length / 5));
        if (distance > 0 && distance <= limit && (!best || distance < best.distance)) {
          best = { task, distance };
        }
      }
    }
  }
  return best?.task ?? null;
}
