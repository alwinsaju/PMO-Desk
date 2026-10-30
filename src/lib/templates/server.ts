// The template library on disk: `library.json` in the templates folder. Server
// only. The Python task scripts read the same file (tasks/shared/template_lib), so
// both sides find it through AI_OS_TEMPLATES_DIR, which the Tasks engine is
// started with (see engineEnv in app/api/tasks-engine/shared.ts).
import path from "node:path";
import { mutexFor, readJsonSafe, writeJsonAtomic } from "../pmo/server/fsx.ts";
import { resolveDataDir } from "../pmo/server/paths.ts";
import { inlineSnippets, snippetsFrom } from "./render.ts";
import {
  checkInput,
  createTemplate,
  deleteTemplate,
  parseLibrary,
  starterLibrary,
  templateFor,
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
  constructor(
    message: string,
    status: 400 | 404 | 500 = 400,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.status = status;
    this.fields = fields;
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

/** The saved library; a first run writes the starters. A damaged file is reported,
 *  never replaced by the starters that the next save would write over it. */
async function readLibrary(env: Env, now: Now): Promise<TemplateLibrary> {
  const read = await readJsonSafe(libraryFile(env));
  if (read.kind === "missing") {
    const fresh = starterLibrary(now());
    await writeJsonAtomic(libraryFile(env), fresh);
    return fresh;
  }
  const library = read.kind === "ok" ? parseLibrary(read.value) : null;
  if (!library) {
    throw new TemplateError("The saved template library could not be read.", 500);
  }
  return library;
}

export const readTemplates = (env: Env = process.env, now: Now = clock) =>
  withLock(env, () => readLibrary(env, now));

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
