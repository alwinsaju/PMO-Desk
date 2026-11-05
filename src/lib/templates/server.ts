// The template library on disk: `library.json` in the templates folder. Server
// only. The Python task scripts read the same file (tasks/shared/template_lib), so
// both sides find it through AI_OS_TEMPLATES_DIR, which the Tasks engine is
// started with (see engineEnv in app/api/tasks-engine/shared.ts).
import { copyFile, stat } from "node:fs/promises";
import path from "node:path";
import { mutexFor, readJsonSafe, writeJsonAtomic } from "../pmo/server/fsx.ts";
import { resolveDataDir } from "../pmo/server/paths.ts";
import { inlineSnippets, snippetsFrom } from "./render.ts";
import {
  addMissingStarters,
  checkInput,
  createTemplate,
  deleteTemplate,
  emptyLibrary,
  parseLibrary,
  parseLibraryDetailed,
  starterLibrary,
  templateFor,
  undeleteTemplate,
  updateTemplate,
  type Change,
} from "./library.ts";
import {
  LIBRARY_FILE,
  type Template,
  type TemplateInput,
  type TemplateLibrary,
} from "./types.ts";

type Env = Record<string, string | undefined>;

export class TemplateError extends Error {
  readonly status: 400 | 404 | 500;
  /** Per-field messages when the edit itself was refused. */
  readonly fields?: Record<string, string>;
  /** "corrupt": library.json could not be read, so the screen can offer to restore it. */
  readonly code?: "corrupt";
  constructor(
    message: string,
    status: 400 | 404 | 500 = 400,
    fields?: Record<string, string>,
    code?: "corrupt",
  ) {
    super(message);
    this.status = status;
    this.fields = fields;
    this.code = code;
  }
}

/** AI_OS_TEMPLATES_DIR, else `templates` inside the PMO data folder. */
export function templatesDir(env: Env = process.env): string {
  const explicit = env.AI_OS_TEMPLATES_DIR?.trim();
  return explicit ? path.resolve(explicit) : path.join(resolveDataDir(env), "templates");
}

const libraryFile = (env: Env) => path.join(templatesDir(env), LIBRARY_FILE);

const withLock = <T>(env: Env, run: () => Promise<T>): Promise<T> =>
  mutexFor(templatesDir(env)).run(run);

type Now = () => string;
const clock: Now = () => new Date().toISOString();

const BACKUP_SUFFIX = ".bak";

/** Copies `file` next to itself as `<file>.bak`, so nothing a person wrote is lost when the library is
 *  rewritten. With `unique`, an earlier copy is never overwritten (the new one is `.bak-<time>`).
 *  Resolves to the copy's name. */
async function keepCopy(file: string, unique = false): Promise<string> {
  let copy = `${file}${BACKUP_SUFFIX}`;
  const taken =
    unique &&
    (await stat(copy).then(
      () => true,
      () => false,
    ));
  if (taken) copy = `${file}${BACKUP_SUFFIX}-${Date.now()}`;
  await copyFile(file, copy);
  return path.basename(copy);
}

export interface LibraryRead {
  library: TemplateLibrary;
  /** Plain-language note when the file held entries that could not be kept, else null. */
  warning: string | null;
}

/** The saved library; a first run writes the starters. A damaged file is reported,
 *  never replaced by the starters that the next save would write over it (the person
 *  chooses to rebuild it, see `restoreBuiltIn`). Entries a hand edit left unusable are
 *  left out, with a copy of the original kept first and a warning for the screen. */
async function readLibraryChecked(env: Env, now: Now): Promise<LibraryRead> {
  const read = await readJsonSafe(libraryFile(env));
  if (read.kind === "missing") {
    const fresh = starterLibrary(now());
    await writeJsonAtomic(libraryFile(env), fresh);
    return { library: fresh, warning: null };
  }
  const parsed = read.kind === "ok" ? parseLibraryDetailed(read.value) : null;
  if (!parsed) {
    throw new TemplateError(
      "The saved template library could not be read.",
      500,
      undefined,
      "corrupt",
    );
  }
  if (parsed.dropped === 0 && parsed.conflicts === 0) {
    return { library: parsed.library, warning: null };
  }
  const copy = await keepCopy(libraryFile(env)).catch(() => null);
  const parts = [
    parsed.dropped > 0
      ? `${parsed.dropped} entr${parsed.dropped === 1 ? "y" : "ies"} in the library file could not be used and ${parsed.dropped === 1 ? "is" : "are"} left out`
      : "",
    parsed.conflicts > 0
      ? `${parsed.conflicts} place${parsed.conflicts === 1 ? "" : "s"} given to two templates stay with the first`
      : "",
  ].filter(Boolean);
  return {
    library: parsed.library,
    warning: `${parts.join("; ")}.${copy ? ` The original file is kept as ${copy}.` : ""}`,
  };
}

const readLibrary = async (env: Env, now: Now): Promise<TemplateLibrary> =>
  (await readLibraryChecked(env, now)).library;

export const readTemplates = (env: Env = process.env, now: Now = clock) =>
  withLock(env, () => readLibrary(env, now));

/** Like `readTemplates`, with the note about entries that had to be left out. */
export const readTemplatesChecked = (env: Env = process.env, now: Now = clock) =>
  withLock(env, () => readLibraryChecked(env, now));

export interface RestoreResult {
  /** Built-in templates put (back) in the library. */
  added: number;
  /** The library file could not be read and was rebuilt from the built-in templates. */
  rebuilt: boolean;
  /** Name of the copy kept of an unreadable file. */
  backup: string | null;
}

/** "Restore built-in templates": rebuilds an unreadable library (keeping a `.bak` copy of the file),
 *  or adds back the built-in templates a readable one no longer has. Never removes or changes a
 *  template that is there. */
export function restoreBuiltIn(
  env: Env = process.env,
  now: Now = clock,
): Promise<RestoreResult> {
  return withLock(env, async () => {
    const file = libraryFile(env);
    const read = await readJsonSafe(file);
    const parsed = read.kind === "ok" ? parseLibrary(read.value) : null;
    if (read.kind !== "missing" && !parsed) {
      const backup = await keepCopy(file, true);
      const fresh = starterLibrary(now());
      await writeJsonAtomic(file, fresh);
      return { added: fresh.templates.length, rebuilt: true, backup };
    }
    const base = parsed ?? emptyLibrary();
    const { library, added } = addMissingStarters(base, now());
    if (added.length > 0 || read.kind === "missing") {
      await writeJsonAtomic(file, library);
    }
    return { added: added.length, rebuilt: false, backup: null };
  });
}

/** Puts a deleted template back as it was (Undo); places another template has taken stay with it. */
export function restoreDeleted(
  body: unknown,
  env: Env = process.env,
  now: Now = clock,
): Promise<{ template: Template; leftBehind: string[] }> {
  const gone = parseLibrary({ templates: [(body as { template?: unknown })?.template] })
    ?.templates[0];
  if (!gone) {
    return Promise.reject(new TemplateError("That template could not be put back.", 400));
  }
  return withLock(env, async () => {
    const library = await readLibrary(env, now);
    const result = undeleteTemplate(library, gone, now());
    if ("error" in result) throw new TemplateError(result.error, 400);
    await writeJsonAtomic(libraryFile(env), result.library);
    return { template: result.template, leftBehind: result.leftBehind };
  });
}
/** The template a target uses, or null. Does not create the library's file. */
export async function resolveTemplate(
  targetKey: string,
  env: Env = process.env,
  variantId?: string | null,
): Promise<Template | null> {
  return withLock(env, async () => {
    const read = await readJsonSafe(libraryFile(env));
    const library = read.kind === "ok" ? parseLibrary(read.value) : null;
    const found = library ? templateFor(library, targetKey) : null;
    if (!library || !found) return null;
    // Other wordings replace the subject and message; snippets are filled in so every user of the
    // template (the browser's apps and, separately, the Python tasks) sees the finished text.
    const variant = variantId
      ? found.variants?.find((v) => v.id === variantId)
      : undefined;
    const snippets = snippetsFrom(library.templates);
    const inline = (s: string) => inlineSnippets(s, snippets);
    return {
      ...found,
      subject: inline(variant?.subject || found.subject),
      to: inline(found.to),
      cc: inline(found.cc),
      body: inline(variant ? variant.body : found.body),
    };
  });
}

function refuse(errors: Record<string, string | undefined>): never {
  const fields = Object.fromEntries(
    Object.entries(errors).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  throw new TemplateError(
    Object.values(fields)[0] ?? "That template is not valid.",
    400,
    fields,
  );
}

async function change(
  env: Env,
  now: Now,
  body: unknown,
  apply: (library: TemplateLibrary, input: TemplateInput) => Change | { error: string },
): Promise<Change> {
  const checked = checkInput(body);
  if (!checked.ok) return refuse(checked.errors);
  const input = checked.value;
  return withLock(env, async () => {
    const library = await readLibrary(env, now);
    const result = apply(library, input);
    if ("error" in result) throw new TemplateError(result.error, 400);
    await writeJsonAtomic(libraryFile(env), result.library);
    return result;
  });
}

export const addTemplate = (body: unknown, env: Env = process.env, now: Now = clock) =>
  change(env, now, body, (library, input) => createTemplate(library, input, now()));

export const saveTemplate = (
  id: string,
  body: unknown,
  env: Env = process.env,
  now: Now = clock,
) =>
  change(env, now, body, (library, input) => updateTemplate(library, id, input, now()));

export function removeTemplate(
  id: string,
  env: Env = process.env,
  now: Now = clock,
): Promise<Template> {
  return withLock(env, async () => {
    const library = await readLibrary(env, now);
    const result = deleteTemplate(library, id);
    if ("error" in result) throw new TemplateError(result.error, 404);
    await writeJsonAtomic(libraryFile(env), result.library);
    return result.removed;
  });
}
