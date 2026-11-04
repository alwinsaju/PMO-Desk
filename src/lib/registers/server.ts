// The file store behind /api/registers: one JSON file per register in `<data dir>/registers`.
// Server only. Every write goes through the register's definition, so a bad value is refused
// with a plain reason and nothing outside the definition is ever saved.
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  mutexFor,
  readJsonSafe,
  writeJsonAtomic,
  writeTextAtomic,
} from "../pmo/server/fsx.ts";
import { resolveDataDir } from "../pmo/server/paths.ts";
import { summarise, type RegisterSummary } from "./alerts.ts";
import { REGISTERS, registerById } from "./defs.ts";
import {
  HISTORY_MAX_ENTRIES,
  HISTORY_TRIM_BYTES,
  entriesFor,
  entryForSave,
  parseHistory,
  serializeEntries,
  trimHistory,
  type HistoryEntry,
} from "./history.ts";
import { RECORD_ID, sanitizeConfig, sanitizeRecord } from "./records.ts";
import {
  MAX_RECORDS,
  type RegisterDef,
  type RegisterFile,
  type RegisterRecord,
} from "./types.ts";

type Env = Record<string, string | undefined>;

export class RegisterError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const registersDir = (env: Env = process.env): string =>
  path.join(resolveDataDir(env), "registers");

const fileOf = (def: RegisterDef, env: Env) =>
  path.join(registersDir(env), `${def.id}.json`);

/** The change history of one tool: its own file, apart from the records. */
export const historyFile = (def: RegisterDef, env: Env = process.env): string =>
  path.join(registersDir(env), "history", `${def.id}.jsonl`);

/** Add entries to a tool's history (call inside the register mutex). Appends; only when the file has
 *  grown past HISTORY_TRIM_BYTES is it rewritten, keeping the newest HISTORY_MAX_ENTRIES, so it cannot
 *  grow without bound. Throws on a file problem: the caller must swallow it. */
async function appendHistory(
  def: RegisterDef,
  entries: readonly HistoryEntry[],
  env: Env,
): Promise<void> {
  if (entries.length === 0) return;
  const file = historyFile(def, env);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, serializeEntries(entries), "utf8");
  const size = await stat(file).then(
    (s) => s.size,
    () => 0,
  );
  if (size > HISTORY_TRIM_BYTES) {
    const all = parseHistory(await readFile(file, "utf8"));
    await writeTextAtomic(file, serializeEntries(trimHistory(all, HISTORY_MAX_ENTRIES)));
  }
}

/** One record's history, newest first. A missing or unreadable file is an empty history, never an error. */
export async function readRecordHistory(
  def: RegisterDef,
  recordId: string,
  env: Env = process.env,
): Promise<HistoryEntry[]> {
  if (!RECORD_ID.test(recordId)) return [];
  try {
    return entriesFor(
      parseHistory(await readFile(historyFile(def, env), "utf8")),
      recordId,
    );
  } catch {
    return [];
  }
}

export function definitionFor(id: string): RegisterDef {
  const def = registerById(id);
  if (!def) throw new RegisterError("That tool does not exist.", 404);
  return def;
}

function parseFile(def: RegisterDef, value: unknown): RegisterFile {
  const raw =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const items: RegisterRecord[] = [];
  for (const entry of Array.isArray(raw.items) ? raw.items : []) {
    const input = entry as Record<string, unknown>;
    if (typeof input?.id !== "string" || !RECORD_ID.test(input.id)) continue;
    const created = typeof input.createdAt === "string" ? input.createdAt : "";
    const updated = typeof input.updatedAt === "string" ? input.updatedAt : created;
    const parsed = sanitizeRecord(def, input, updated || new Date(0).toISOString());
    if (parsed.ok) {
      items.push({ ...parsed.record, createdAt: created || parsed.record.createdAt });
    }
  }
  return { items, config: sanitizeConfig(def, raw.config) };
}

export async function readRegister(
  def: RegisterDef,
  env: Env = process.env,
): Promise<RegisterFile> {
  const read = await readJsonSafe(fileOf(def, env));
  if (read.kind === "missing")
    return { items: [], config: sanitizeConfig(def, undefined) };
  if (read.kind === "corrupt") {
    throw new RegisterError(`The saved ${def.title} could not be read.`, 500);
  }
  return parseFile(def, read.value);
}

export interface RegisterChanges {
  upsert?: unknown;
  remove?: unknown;
  config?: unknown;
}

const MAX_BATCH = 500;

/** Apply a batch of changes: records to add or replace, ids to remove, new settings. Returns the whole register. */
export function applyRegisterChanges(
  def: RegisterDef,
  body: unknown,
  env: Env = process.env,
  now: () => string = () => new Date().toISOString(),
): Promise<RegisterFile> {
  const changes = (
    typeof body === "object" && body !== null ? body : {}
  ) as RegisterChanges;
  return mutexFor(registersDir(env)).run(async () => {
    const file = await readRegister(def, env);
    const stamp = now();
    const byId = new Map(file.items.map((i) => [i.id, i]));
    // Which fields changed (keys only, never values), for the local history written after the save.
    const history: HistoryEntry[] = [];

    if (changes.remove !== undefined) {
      if (!Array.isArray(changes.remove) || changes.remove.length > MAX_BATCH) {
        throw new RegisterError("Remove needs a list of ids.");
      }
      for (const id of changes.remove) {
        if (typeof id !== "string") continue;
        if (byId.delete(id)) history.push({ at: stamp, id, kind: "deleted" });
      }
    }
    if (changes.upsert !== undefined) {
      if (!Array.isArray(changes.upsert) || changes.upsert.length > MAX_BATCH) {
        throw new RegisterError(`Send at most ${MAX_BATCH} records at a time.`);
      }
      for (const input of changes.upsert) {
        const id = (input as { id?: unknown })?.id;
        const existing = typeof id === "string" ? byId.get(id) : undefined;
        const parsed = sanitizeRecord(def, input, stamp, existing);
        if (!parsed.ok) throw new RegisterError(parsed.reason);
        byId.set(parsed.record.id, parsed.record);
        const entry = entryForSave(def, existing, parsed.record, stamp);
        if (entry) history.push(entry);
      }
    }
    if (byId.size > MAX_RECORDS) {
      throw new RegisterError(`A register holds at most ${MAX_RECORDS} records.`);
    }
    const next: RegisterFile = {
      items: [...byId.values()],
      config:
        changes.config !== undefined ? sanitizeConfig(def, changes.config) : file.config,
    };
    await writeJsonAtomic(fileOf(def, env), { version: 1, ...next });
    // The record is saved. The history is a best-effort extra: a failure here must never fail the save.
    try {
      await appendHistory(def, history, env);
    } catch (error) {
      console.error("[registers] could not write the change history:", error);
    }
    return next;
  });
}

/** Open, late and soon counts for every register: what the toolkit and the Dashboard show. */
export async function readSummaries(
  today: string,
  env: Env = process.env,
): Promise<RegisterSummary[]> {
  const out: RegisterSummary[] = [];
  for (const def of REGISTERS) {
    try {
      const file = await readRegister(def, env);
      out.push(summarise(def, file.items, { today, config: file.config }));
    } catch {
      out.push({ id: def.id, total: 0, open: 0, late: 0, soon: 0 });
    }
  }
  return out;
}
