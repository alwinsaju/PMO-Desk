"use client";

import { createTodo } from "@/components/apps/pmo-todo-app/api";
import { emptyDraft } from "@/lib/pmo/todoLogic";
import type { TodoSeed } from "@/lib/registers/reports";
import type { Person } from "@/lib/registers/timesheets";

/** Make a PMO to-do from a register record. The to-do is the person's to approve like any other. */
export async function createTodoFrom(
  seed: TodoSeed,
  people: readonly Person[],
): Promise<{ ok: true; todoId: string } | { ok: false; reason: string }> {
  const email = seed.owner
    ? (people.find((p) => p.name.toLowerCase() === seed.owner!.toLowerCase())?.email ??
      null)
    : null;
  try {
    const reply = await createTodo({
      ...emptyDraft(seed.title),
      description: seed.description,
      owner: { name: seed.owner, email, isMe: seed.owner === null },
      dueAt: seed.dueAt,
      tags: seed.tags,
    });
    return reply.ok
      ? { ok: true, todoId: reply.todo.id }
      : { ok: false, reason: reply.reason };
  } catch {
    return { ok: false, reason: "Could not reach the app server." };
  }
}
