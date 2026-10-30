// Quick-add: "Send deck to Priya Fri" -> a to-do titled "Send deck to Priya" due that Friday.
// Only a day at the END of the text is read as a due date, and only when the rest is
// still a title; the day itself is understood by the same code as the command bar.
import { resolveWhen } from "../ai-runtime/whenPhrase.ts";

export interface QuickAdd {
  title: string;
  /** yyyy-mm-dd, or null when no day was written. */
  dueAt: string | null;
}

const CONNECTORS = new Set(["by", "on", "due", "until", "for"]);
const MAX_PHRASE_WORDS = 3;
export const MAX_QUICK_ADD_LENGTH = 200;

export function parseQuickAdd(input: string, today: string): QuickAdd | null {
  const text = input.replace(/\s+/g, " ").trim().slice(0, MAX_QUICK_ADD_LENGTH).trim();
  if (!text) return null;
  const words = text.split(" ");

  for (let size = Math.min(MAX_PHRASE_WORDS, words.length - 1); size >= 1; size--) {
    const phrase = words
      .slice(-size)
      .join(" ")
      .replace(/[,.;!?]+$/, "");
    const range = phrase ? resolveWhen(phrase, today) : null;
    // A single day only: "this week" or "next weekend" are not a due date.
    if (!range || range.from !== range.to) continue;
    let rest = words.slice(0, -size);
    // "due on Friday", "by Friday": the connector goes with the date.
    while (rest.length > 1 && CONNECTORS.has(rest[rest.length - 1].toLowerCase())) {
      rest = rest.slice(0, -1);
    }
    const title = rest
      .join(" ")
      .replace(/[\s,;:-]+$/, "")
      .trim();
    if (title) return { title, dueAt: range.from };
  }
  return { title: text, dueAt: null };
}
