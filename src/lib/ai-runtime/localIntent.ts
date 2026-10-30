// Commands the command bar carries out in the browser, because the data they need or the
// way they finish lives there (the to-do list and its dialogs, the Tasks engine): creating a
// to-do, snoozing, closing or chasing one, and "did that report run?". Like pmoIntent.ts it
// recognises only what it is sure of and returns null otherwise. Pure.
import { findTask } from "../tasks-engine/catalog.ts";
import { parseFocusCommand } from "../focusMode.ts";

export type LocalIntent =
  | { kind: "create_todo"; text: string }
  | {
      kind: "todo_action";
      action: "snooze" | "done" | "chase";
      query: string;
      until: string;
    }
  | { kind: "run_info"; taskId: string | null; question: "ran" | "failed" }
  | { kind: "explain" }
  | { kind: "focus"; minutes: number };

const EXPLAIN =
  /^(?:please\s+)?(?:explain|describe|summari[sz]e)\s+(?:this|the\s+current|the\s+focused)\s+(?:screen|window|app|page|view)\b|^what\s+am\s+i\s+(?:looking\s+at|seeing)\b|^what(?:['’]s|\s+is)\s+this\s+(?:screen|window|app|page)\b|^help\s+me\s+with\s+this\s+(?:screen|window|app)\b/i;

const clean = (text: string): string =>
  text
    .replace(/[?!.]+\s*$/g, "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();

const CREATE_PATTERNS: readonly RegExp[] = [
  /^(?:please\s+)?remind\s+me\s+to\s+(.+)$/i,
  /^(?:please\s+)?(?:add|create|make)\s+(?:me\s+)?(?:a\s+|an\s+)?(?:new\s+)?(?:to-?do|task|reminder)\s*(?:to|for|called|named|:|-)?\s*(.+)$/i,
  /^(?:please\s+)?new\s+(?:to-?do|task|reminder)\s*(?::|-)?\s*(.+)$/i,
];

const SNOOZE =
  /^(?:please\s+)?snooze\s+(?:the\s+)?(.+?)(?:\s+(?:to|until|till|for)\s+(.+))?$/i;
const DONE_PATTERNS: readonly RegExp[] = [
  /^(?:please\s+)?(?:mark|set)\s+(?:the\s+)?(.+?)\s+(?:as\s+)?(?:done|complete|completed|finished|closed)$/i,
  /^(?:please\s+)?(?:complete|finish|close)\s+(?:the\s+)?(?:to-?do\s+)?(.+)$/i,
];
const CHASE =
  /^(?:please\s+)?chase\s+(?:up\s+)?(.+?)\s+(?:on|about|for|re|regarding)\s+(?:the\s+)?(.+)$/i;

const RAN =
  /^(?:did|has|have)\s+(?:the\s+)?(.+?)\s+(?:run|ran|been\s+run|go\s+out|completed?)\b/i;
const FAILED =
  /^why\s+(?:did|has|is|does)\s+(?:the\s+)?(?:last\s+run\s+(?:of\s+)?)?(.*?)\s*(?:last\s+run\s+)?(?:fail(?:ed)?|stop(?:ped)?|break|broken|not\s+work(?:ing)?)\b/i;

export function resolveLocalIntent(prompt: string): LocalIntent | null {
  const text = prompt.trim().replace(/\s+/g, " ");
  if (!text) return null;

  if (EXPLAIN.test(text)) return { kind: "explain" };

  const focus = parseFocusCommand(text);
  if (focus !== null) return { kind: "focus", minutes: focus };
  for (const pattern of CREATE_PATTERNS) {
    const match = pattern.exec(text);
    const body = match ? clean(match[1]) : "";
    if (body) return { kind: "create_todo", text: body };
  }

  const chase = CHASE.exec(text);
  if (chase && clean(chase[2])) {
    return {
      kind: "todo_action",
      action: "chase",
      query: clean(chase[2]),
      until: clean(chase[1]),
    };
  }

  const snooze = SNOOZE.exec(text);
  if (snooze && clean(snooze[1])) {
    return {
      kind: "todo_action",
      action: "snooze",
      query: clean(snooze[1]),
      until: clean(snooze[2] ?? ""),
    };
  }

  for (const pattern of DONE_PATTERNS) {
    const match = pattern.exec(text);
    const query = match ? clean(match[1]) : "";
    // "close Notes" is closing a window, not a to-do: only a to-do-looking phrase.
    if (
      query &&
      !/^(?:notes?|files?|tasks?|dashboard|browser|staff|templates?|app\s?store|this|it)$/i.test(
        query,
      ) &&
      !/\b(?:window|app|tab|panel|dialog)\b/i.test(query)
    ) {
      return { kind: "todo_action", action: "done", query, until: "" };
    }
  }

  const failed = FAILED.exec(text);
  if (failed) {
    const task = findTask(failed[1] ?? "");
    return { kind: "run_info", taskId: task?.id ?? null, question: "failed" };
  }
  const ran = RAN.exec(text);
  if (ran) {
    const task = findTask(ran[1]);
    if (task) return { kind: "run_info", taskId: task.id, question: "ran" };
  }
  return null;
}
