// File handling for the saved-examples library (savedExamples.ts has the pure
// logic): one small JSON file, `state/saved-examples.json` in the PMO data
// folder, holding the "Use my saved examples in prompts" switch and the
// examples. Written atomically (temp file, fsync, rename) under the same
// per-data-folder mutex every other PMO store uses (`store.withLock`), and
// sanitised on every read, so a damaged or hand-edited file reads as an empty
// library (switch off) and never stops the structuring queue. Local files only:
// nothing here logs example text or sends it anywhere.
import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  addSavedExample,
  buildSavedExample,
  emptySavedExamples,
  sanitizeSavedExamplesFile,
  selectExamples,
  type ExampleDraft,
  type SavedExample,
  type SavedExamplesFile,
} from "../savedExamples.ts";
import { moveFile, readJsonSafe, writeJsonAtomic } from "./fsx.ts";
import type { Store } from "./store.ts";

export const SAVED_EXAMPLES_VERSION = 1;

export function savedExamplesFile(root: string): string {
  return path.join(root, "state", "saved-examples.json");
}

/** Reads and sanitises. Never throws: a missing, locked, unparsable or
 *  malformed file is an empty library with the switch off. For prompts and
 *  listing only; a change goes through `mutate`, which does not guess. */
export async function loadSavedExamples(root: string): Promise<SavedExamplesFile> {
  try {
    const read = await readJsonSafe(savedExamplesFile(root));
    return read.kind === "ok"
      ? sanitizeSavedExamplesFile(read.value)
      : emptySavedExamples();
  } catch {
    return emptySavedExamples();
  }
}

type Change<T> =
  { ok: true; file: SavedExamplesFile; value: T } | { ok: false; reason: string };

/** Read-change-write under the data folder's lock. A file that cannot be parsed
 *  is first moved to corrupt/saved-examples/ (never deleted); a file that cannot
 *  be read for an I/O reason is left alone and the change fails, so a locked file
 *  is never overwritten with a guess. */
async function mutate<T>(
  store: Store,
  change: (current: SavedExamplesFile) => Change<T>,
): Promise<
  { ok: true; value: T; file: SavedExamplesFile } | { ok: false; reason: string }
> {
  return store.withLock(async () => {
    const file = savedExamplesFile(store.root);
    let current = emptySavedExamples();
    try {
      const read = await readJsonSafe(file);
      if (read.kind === "ok") current = sanitizeSavedExamplesFile(read.value);
      if (read.kind === "corrupt") {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        await moveFile(
          file,
          path.join(
            store.paths.corrupt,
            "saved-examples",
            `saved-examples.json.${stamp}`,
          ),
        ).catch(() => undefined);
      }
    } catch {
      return {
        ok: false as const,
        reason: "The saved examples file could not be read just now. Try again.",
      };
    }
    const result = change(current);
    if (!result.ok) return result;
    await writeJsonAtomic(file, { version: SAVED_EXAMPLES_VERSION, ...result.file });
    return { ok: true as const, value: result.value, file: result.file };
  });
}

export const newExampleId = () => `ex_${randomBytes(8).toString("hex")}`;

/** Save one example. A full library refuses; the same message saved again
 *  replaces the earlier example. */
export async function saveExample(
  store: Store,
  input: { subject: string; message: string; draft: ExampleDraft; now: Date },
): Promise<
  | { ok: true; example: SavedExample; replaced: boolean; count: number }
  | { ok: false; reason: string }
> {
  const example = buildSavedExample({
    id: newExampleId(),
    savedAt: input.now.toISOString(),
    subject: input.subject,
    message: input.message,
    draft: input.draft,
  });
  if (!example)
    return { ok: false, reason: "There is no message text or title to save." };
  const done = await mutate(store, (current) => {
    const added = addSavedExample(current, example);
    return added.ok
      ? { ok: true, file: added.file, value: added.replaced }
      : { ok: false, reason: added.reason };
  });
  if (!done.ok) return done;
  return { ok: true, example, replaced: done.value, count: done.file.examples.length };
}

export async function deleteExample(
  store: Store,
  id: string,
): Promise<{ ok: true; file: SavedExamplesFile } | { ok: false; reason: string }> {
  const done = await mutate(store, (current) => {
    const examples = current.examples.filter((e) => e.id !== id);
    if (examples.length === current.examples.length) {
      return { ok: false, reason: "That example is no longer saved." };
    }
    return { ok: true, file: { ...current, examples }, value: null };
  });
  return done.ok ? { ok: true, file: done.file } : done;
}

export async function setExamplesEnabled(
  store: Store,
  enabled: boolean,
): Promise<{ ok: true; file: SavedExamplesFile } | { ok: false; reason: string }> {
  const done = await mutate(store, (current) => ({
    ok: true,
    file: { ...current, enabled },
    value: null,
  }));
  return done.ok ? { ok: true, file: done.file } : done;
}

/**
 * The saved examples to put in the structuring prompt for `message`: none when
 * the switch is off, the library is empty or the file is unusable; otherwise the
 * (at most two) most similar. Never throws and never logs.
 */
export async function examplesForPrompt(
  root: string,
  message: string,
): Promise<SavedExample[]> {
  const file = await loadSavedExamples(root);
  return file.enabled ? selectExamples(file.examples, message) : [];
}
