// Which AI model this installation uses, beyond what the environment says:
// the choice Setup saved (for example "the smaller model" when the default does
// not fit this computer), kept in a small JSON file next to the PMO data, and
// the rule that turns env / saved / default / what is installed into the one
// model a call asks for. Imports nothing extensionless (plain Node runs the
// tests), and reads the file on demand so a save by a Setup route takes effect
// in every module instance at once.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveDataDir } from "../pmo/server/paths.ts";
import { FALLBACK_MODEL, LIGHT_MODEL, sameModel } from "../setup/models.ts";
import { DEFAULT_AI_RUNTIME_CONFIG } from "./core.ts";

type Env = Record<string, string | undefined>;

export type ModelSource = "env" | "saved" | "default" | "only-installed";

export interface ModelChoice {
  model: string;
  source: ModelSource;
  /** What was asked for before the installed-model rule applied. */
  preferred: string;
  /** Why the model differs from the preferred one, for the status line. */
  note?: string;
}

/** The models Setup may save: the shipped default, the smaller fallback and the light
 *  model the "Fast AI model" switch uses. */
export function allowedModels(): string[] {
  return [DEFAULT_AI_RUNTIME_CONFIG.defaultModel, FALLBACK_MODEL, LIGHT_MODEL];
}

/** AI_OS_AI_MODEL_FILE (tests), else `ai-model.json` in the PMO data dir. */
export function modelChoicePath(env: Env = process.env): string {
  const explicit = env.AI_OS_AI_MODEL_FILE?.trim();
  return explicit || path.join(resolveDataDir(env), "ai-model.json");
}

const canonical = (model: string): string | undefined =>
  allowedModels().find((allowed) => sameModel(allowed, model));

/** The saved model, or undefined when the file is missing, unreadable, or names
 *  something that is not an allowed model. */
export function readSavedModel(env: Env = process.env): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(modelChoicePath(env), "utf8")) as unknown;
    const model = (parsed as { model?: unknown } | null)?.model;
    return typeof model === "string" ? canonical(model) : undefined;
  } catch {
    return undefined;
  }
}

export type SaveResult = { ok: true } | { ok: false; reason: string };

export function saveModelChoice(model: string, env: Env = process.env): SaveResult {
  const known = canonical(model);
  if (!known) return { ok: false, reason: `${model} is not a model PMO Desk can use.` };
  const file = modelChoicePath(env);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ model: known })}\n`);
    renameSync(tmp, file);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: `Could not save the model choice: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export interface ChooseInput {
  /** OLLAMA_MODEL, when set: an explicit pin that nothing overrides. */
  envModel?: string;
  saved?: string;
  defaultModel: string;
  /** Names Ollama reports as installed; null when it could not be asked. */
  installed: string[] | null;
}

/** env > saved > default; and when that model is not installed but another allowed one is,
 *  the first of those (a computer with only the small model, or one whose chosen model was
 *  just removed or is still downloading, must work without anyone editing settings). */
export function chooseModel(input: ChooseInput): ModelChoice {
  const { envModel, saved, defaultModel, installed } = input;
  const preferred = envModel || saved || defaultModel;
  const source: ModelSource = envModel ? "env" : saved ? "saved" : "default";
  const plain: ModelChoice = { model: preferred, source, preferred };
  if (envModel || installed === null) return plain;
  const has = (name: string) => installed.some((i) => sameModel(i, name));
  if (has(preferred)) return plain;
  const present = allowedModels().filter(has);
  if (present.length === 0) return plain;
  return {
    model: present[0],
    source: "only-installed",
    preferred,
    note: `Using ${present[0]} because ${preferred} is not installed.`,
  };
}

export interface ModelResolver {
  current(): ModelChoice;
  /** Feed the latest /api/tags result (null = unknown). */
  observeInstalled(installed: string[] | null): void;
}

export function createModelResolver(options: { env?: Env } = {}): ModelResolver {
  const env = options.env ?? process.env;
  let installed: string[] | null = null;
  return {
    current: () =>
      chooseModel({
        envModel: env.OLLAMA_MODEL?.trim() || undefined,
        saved: readSavedModel(env),
        defaultModel: DEFAULT_AI_RUNTIME_CONFIG.defaultModel,
        installed,
      }),
    observeInstalled: (names) => {
      installed = names;
    },
  };
}
