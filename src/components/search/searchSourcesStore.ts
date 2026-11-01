"use client";

// Wires the Ctrl+K slow sources to the app's own APIs and keeps one cache for the session.
import { fetchState } from "@/components/apps/pmo-todo-app/api";
import { fetchLibrary } from "@/components/apps/templates-app/api";
import { fetchRegister } from "@/components/apps/toolkit/registersApi";
import { explainError } from "@/lib/platform/friendlyError";
import { REGISTERS } from "@/lib/registers/defs";
import { recordTitle, textOf } from "@/lib/registers/records";
import { recordItems, templateItems, todoItems } from "@/lib/search/searchIndex";
import { createSourceCache, type SourceLoaders } from "@/lib/search/searchSourceCache";
import { combineRecordLoads, type LoadResult } from "@/lib/search/searchSources";

/** Data younger than this is reused when the app starts loading ahead of time. */
export const PREFETCH_MAX_AGE_MS = 60_000;
/** Opening the box refreshes in the background unless data is this fresh. */
export const OPEN_MAX_AGE_MS = 5_000;
const REGISTER_CONCURRENCY = 4;

async function loadTodos(): Promise<LoadResult> {
  const state = await fetchState();
  return { ok: true, items: todoItems(state.todos) };
}

async function loadTemplates(): Promise<LoadResult> {
  const reply = await fetchLibrary();
  return reply.ok
    ? { ok: true, items: templateItems(reply.templates) }
    : { ok: false, message: reply.reason };
}

async function loadRegister(def: (typeof REGISTERS)[number]): Promise<LoadResult> {
  try {
    const reply = await fetchRegister(def.id);
    if (!reply.ok) return { ok: false, message: reply.reason };
    return {
      ok: true,
      items: recordItems(
        { id: def.id, title: def.title },
        reply.items.map((r) => ({
          id: r.id,
          title: recordTitle(def, r),
          subtitle: def.statusKey ? textOf(r, def.statusKey) : "",
          keywords: Object.values(r.values)
            .map((v) => (Array.isArray(v) ? v.join(" ") : String(v)))
            .join(" "),
        })),
      ),
    };
  } catch (error) {
    return { ok: false, message: explainError(error).message };
  }
}

async function loadRecords(): Promise<LoadResult> {
  const queue = [...REGISTERS];
  const tools: { title: string; result: LoadResult }[] = [];
  const worker = async () => {
    for (let def = queue.shift(); def; def = queue.shift()) {
      tools.push({ title: def.title, result: await loadRegister(def) });
    }
  };
  await Promise.all(Array.from({ length: REGISTER_CONCURRENCY }, worker));
  return combineRecordLoads(tools);
}

const loaders: SourceLoaders = {
  todos: loadTodos,
  templates: loadTemplates,
  records: loadRecords,
};

export const searchSources = createSourceCache({
  loaders,
  now: Date.now,
  describeError: (error) => explainError(error).message,
});
