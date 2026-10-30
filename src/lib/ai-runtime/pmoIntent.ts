// Recognises the PMO questions and requests the command bar can answer without the
// model: "who's off next Monday?", "what's overdue?", "prepare this week's aging
// report". Fast, works with Ollama stopped, and never guesses: anything it does not
// recognise returns null and goes to the model as before. Pure (no node imports).
import { findTask } from "../tasks-engine/catalog.ts";

export const PMO_TOPICS = ["overdue", "chasers", "open", "summary"] as const;
export type PmoTopic = (typeof PMO_TOPICS)[number];

export type PmoIntent =
  | { kind: "whos_off"; when: string }
  | { kind: "pmo_status"; topic: PmoTopic }
  | { kind: "prepare_task"; taskId: string }
  | { kind: "person_back"; name: string }
  | { kind: "person_shift"; name: string; when: string }
  | { kind: "changes"; since: string };

/** "Ana" from "when is Ana back?" ; stops a stray "the"/"is" becoming part of a name. */
const tidyName = (text: string): string =>
  text
    .replace(/[?!.,]+$/g, "")
    .replace(/^(?:the|our|my)\s+/i, "")
    .trim();

const BACK_PATTERNS: readonly RegExp[] = [
  /\bwhen\s+(?:is|will|does|did)\s+(.+?)\s+(?:be\s+)?(?:back|return(?:ing)?|come\s+back|get\s+back)\b/i,
  /\bwhen\s+(?:is|does)\s+(.+?)['’]s\s+(?:leave|pto|time\s+off|holiday)\s+(?:end|over|finish)/i,
  /^is\s+(.+?)\s+back\b/i,
];

const SHIFT_PATTERNS: readonly RegExp[] = [
  /\bwhat(?:['’]s|\s+is)\s+(.+?)['’]s\s+shift\b(.*)$/i,
  /\bwhat\s+shift\s+(?:is|does)\s+(.+?)\s+(?:on|have|work|working)\b(.*)$/i,
  /\bwhen\s+is\s+(.+?)\s+(?:working|on\s+shift)\b(.*)$/i,
];

const CHANGES_PATTERN =
  /\bwhat(?:['’]s|\s+has|\s+have)?\s+(?:been\s+)?(?:changed|new|happened)\b\s*(?:since\s+)?(.*)$/i;

/** "off", "out", "away", "on leave" ... as people say who is not working. */
const AWAY = String.raw`(?:off|out(?:\s+of(?:\s+the)?\s+office)?|away|absent|on\s+(?:leave|pto|vacation|holiday|time\s+off))`;
const AWAY_PATTERNS: readonly RegExp[] = [
  new RegExp(
    String.raw`\bwho(?:\s+all)?(?:['’]s|\s+is|\s+are|s)?\s+(?:going\s+to\s+be\s+|gonna\s+be\s+|will\s+be\s+)?${AWAY}\b(.*)$`,
    "i",
  ),
  new RegExp(
    String.raw`\b(?:is|are|will)\s+(?:anyone|anybody|someone|everyone|any\s+of\s+(?:us|the\s+team))\s+(?:be\s+)?${AWAY}\b(.*)$`,
    "i",
  ),
  new RegExp(String.raw`\b(?:anyone|anybody)\s+(?:who\s+is\s+)?${AWAY}\b(.*)$`, "i"),
];

const CHASE_WORD = String.raw`(?:chase|chasers?|chasing|follow[- ]?ups?)`;

const STATUS_PATTERNS: readonly { topic: PmoTopic; pattern: RegExp }[] = [
  {
    topic: "chasers",
    pattern: new RegExp(
      String.raw`^(?:what|which|who|any|show|list|how\s+many|do\s+i|are\s+there)\b.*\b${CHASE_WORD}\b|\b(?:overdue|due)\s+${CHASE_WORD}\b`,
      "i",
    ),
  },
  {
    topic: "overdue",
    pattern:
      /^(?:what|which|who|any|show|list|how\s+many|do\s+i|are\s+there)\b.*\boverdue\b|\boverdue\s+(?:to[- ]?dos?|items?|tasks?)\b/i,
  },
  {
    topic: "summary",
    pattern:
      /\bpmo\s+(?:status|summary|update|overview)\b|\bwhat\s+needs\s+(?:my\s+)?attention\b|\bwhat(?:['’]s|\s+is)\s+on\s+my\s+plate\b/i,
  },
  {
    topic: "open",
    pattern:
      /\bhow\s+many\s+(?:open\s+)?(?:to[- ]?dos?|items?)\b|^(?:what|which|show|list)\b.*\b(?:my|open)\s+(?:open\s+)?to[- ]?dos?\b|^(?:my|open)\s+(?:open\s+)?to[- ]?dos?\??$/i,
  },
];

const PREPARE_VERB =
  /^(?:please\s+|can\s+you\s+|could\s+you\s+|will\s+you\s+)?(?:prepare|prep|build|generate|run|start|kick\s+off|get\s+ready|set\s+up)\b(.*)$/i;

/** "on next Monday?" -> "next Monday". */
const tidyWhen = (text: string): string =>
  text
    .replace(/[?!.]+\s*$/g, "")
    .replace(/^\s*(?:on|for|during|from|in|at|by)\s+/i, "")
    .trim();

export function resolvePmoIntent(prompt: string): PmoIntent | null {
  const text = prompt.trim().replace(/\s+/g, " ");
  if (!text) return null;

  for (const pattern of BACK_PATTERNS) {
    const match = pattern.exec(text);
    const name = match ? tidyName(match[1]) : "";
    if (name) return { kind: "person_back", name };
  }

  for (const pattern of SHIFT_PATTERNS) {
    const match = pattern.exec(text);
    const name = match ? tidyName(match[1]) : "";
    if (name) return { kind: "person_shift", name, when: tidyWhen(match![2] ?? "") };
  }

  const changes = CHANGES_PATTERN.exec(text);
  if (changes && /\b(?:changed|new|happened)\b/i.test(text) && !/\bwho\b/i.test(text)) {
    const since = changes[1].replace(/[?!.]+\s*$/g, "").trim();
    // "what's new" alone is not a question about changes; it needs a "since ..." or a period.
    if (since || /\bchanged\b/i.test(text)) return { kind: "changes", since };
  }

  for (const pattern of AWAY_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return { kind: "whos_off", when: tidyWhen(match[1] ?? "") };
  }

  for (const { topic, pattern } of STATUS_PATTERNS) {
    if (pattern.test(text)) return { kind: "pmo_status", topic };
  }

  const prepare = PREPARE_VERB.exec(text);
  const task = prepare ? findTask(prepare[1]) : null;
  if (task) return { kind: "prepare_task", taskId: task.id };

  return null;
}
