// File handling behind /api/ui-state: one JSON file per allow-listed key in
// `<PMO data dir>/ui-state`. Server only. The route stays thin; everything that
// can be tested without Next lives here.
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { readJson, writeJsonAtomic } from "../pmo/server/fsx.ts";
import { resolveDataDir } from "../pmo/server/paths.ts";

type Env = Record<string, string | undefined>;

export const UI_STATE_KEYS = [
  "notes",
  "pinned-apps",
  "installed-apps",
  "preferences",
  "appearance",
  "tasks-prefs",
  "staff-prefs",
  "dashboard-prefs",
  "template-usage",
  "platform-prefs",
] as const;
export type UiStateKey = (typeof UI_STATE_KEYS)[number];

export const MAX_BODY_BYTES = 1024 * 1024;

/** Notes keep every note in one document and a single long note can pass 1 MB,
 *  so that key gets a larger bound; everything else stays small. */
const BODY_LIMITS: Partial<Record<UiStateKey, number>> = {
  notes: 16 * 1024 * 1024,
};

export function maxBodyBytesFor(key: string): number {
  return (isUiStateKey(key) ? BODY_LIMITS[key] : undefined) ?? MAX_BODY_BYTES;
}

function limitText(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

const KEY_SET: ReadonlySet<string> = new Set(UI_STATE_KEYS);

/** Exact, case-sensitive match against the fixed list: the key is never used to
 *  build a path unless it is one of these literals. */
export function isUiStateKey(key: unknown): key is UiStateKey {
  return typeof key === "string" && KEY_SET.has(key);
}

export function uiStateDir(env: Env = process.env): string {
  return path.join(resolveDataDir(env), "ui-state");
}

/** null for any key that is not allow-listed. */
export function uiStatePath(key: string, env: Env = process.env): string | null {
  return isUiStateKey(key) ? path.join(uiStateDir(env), `${key}.json`) : null;
}

/** null when nothing is stored, the file is corrupt, or it holds something other
 *  than an object/array. Real I/O errors (locked, no permission) still throw. */
export async function readUiState(key: string, env: Env = process.env): Promise<unknown> {
  const file = uiStatePath(key, env);
  if (!file) return null;
  let value: unknown;
  try {
    value = await readJson(file);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  return value !== null && typeof value === "object" ? value : null;
}

/** The stored value plus when its file was last written (ms since epoch), which
 *  lets a client tell whether its own unsaved copy is newer. */
export async function readUiStateWithTime(
  key: string,
  env: Env = process.env,
): Promise<{ value: unknown; updatedAt: number | null }> {
  const value = await readUiState(key, env);
  const file = uiStatePath(key, env);
  if (value === null || !file) return { value, updatedAt: null };
  try {
    return { value, updatedAt: Math.floor((await stat(file)).mtimeMs) };
  } catch {
    return { value, updatedAt: null };
  }
}

export async function writeUiState(
  key: string,
  value: unknown,
  env: Env = process.env,
): Promise<void> {
  const file = uiStatePath(key, env);
  if (!file) throw new Error("Unknown ui-state key.");
  await writeJsonAtomic(file, value);
}

/** Forget a key; fine if it was never stored. */
export async function removeUiState(key: string, env: Env = process.env): Promise<void> {
  const file = uiStatePath(key, env);
  if (!file) throw new Error("Unknown ui-state key.");
  await rm(file, { force: true });
}

const putBodySchema = z.object({
  value: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]),
});

export type PutBodyResult =
  { ok: true; value: object } | { ok: false; status: 400 | 413; reason: string };

/** Validate the raw PUT body text: within the key's size limit, JSON, `{ value: object | array }`. */
export function parsePutBody(
  text: string,
  maxBytes: number = MAX_BODY_BYTES,
): PutBodyResult {
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    return {
      ok: false,
      status: 413,
      reason: `The saved state is too large (limit ${limitText(maxBytes)}).`,
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, status: 400, reason: "The request body must be JSON." };
  }
  const parsed = putBodySchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status: 400, reason: "Expected { value: <object or array> }." };
  }
  return { ok: true, value: parsed.data.value };
}
