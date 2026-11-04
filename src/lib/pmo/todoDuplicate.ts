// Duplicating a to-do goes through the ordinary create path (a draft), so the copy is a new to-do
// with its own id and times. Nothing of the original's life is carried over: no id, no created,
// approved, updated or completed time, no history, no source message, no waiting, no blockers,
// no reminders or snooze, and the steps and action items start fresh.
import { nextTodoDraft } from "./recurrence.ts";
import type { Todo, TodoDraft } from "./types.ts";

const COPY_SUFFIX = " (copy)";
const TITLE_MAX = 200;

/** The draft of a copy of `todo`: same title (marked "(copy)"), description, people, due day, priority, tags, repeat, action items and kind of steps. */
export function duplicateTodoDraft(
  todo: Pick<
    Todo,
    | "title"
    | "description"
    | "owner"
    | "requester"
    | "dueAt"
    | "priority"
    | "tags"
    | "recurrence"
    | "actionItems"
    | "checkpoints"
  >,
): TodoDraft {
  const base = nextTodoDraft(todo, todo.dueAt ?? "");
  const title = todo.title.trim();
  return {
    ...base,
    title: `${title.slice(0, TITLE_MAX - COPY_SUFFIX.length)}${COPY_SUFFIX}`,
    dueAt: todo.dueAt,
    // Action items keep their own due days here (a next round clears them; a copy is the same job).
    actionItems: todo.actionItems.map((item) => ({
      text: item.text,
      owner: item.owner ?? null,
      dueAt: item.dueAt ?? null,
    })),
  };
}
