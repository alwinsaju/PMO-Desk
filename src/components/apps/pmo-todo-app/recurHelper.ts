"use client";

import { toast } from "@/lib/notifications/toastStore";
import { usePreferences } from "@/lib/preferences/preferencesStore";
import { nextTodoDraft } from "@/lib/pmo/recurrence";
import type { Todo } from "@/lib/pmo/types";
import { createTodo, patchTodo } from "./api";
import { formatDay } from "./queueView";

/**
 * A repeating to-do was just closed. Unless the person turned it off (Settings), the next one
 * is created at once, with an Undo; if that is turned off or the creation is refused, `offer`
 * runs and the old "Create next one" prompt is shown instead. `today` words the due day.
 */
export async function continueRecurrence(
  todo: Todo,
  next: { dueAt: string },
  today: string,
  offer: () => void,
): Promise<void> {
  if (!usePreferences.getState().autoRecur) {
    offer();
    return;
  }
  try {
    const reply = await createTodo(nextTodoDraft(todo, next.dueAt));
    if (!reply.ok) {
      offer();
      return;
    }
    const created = reply.todo;
    toast({
      key: `recur-${todo.id}`,
      message: `Created the next "${todo.title}", due ${formatDay(next.dueAt, today)}.`,
      action: {
        label: "Undo",
        run: () => void patchTodo(created.id, { status: "cancelled" }),
      },
    });
  } catch {
    offer();
  }
}
