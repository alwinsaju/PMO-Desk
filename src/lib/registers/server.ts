// The file store behind /api/registers: one JSON file per register in `<data dir>/registers`.
// Server only. Every write goes through the register's definition, so a bad value is refused
// with a plain reason and nothing outside the definition is ever saved.
import { createHash } from "node:crypto";
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
import { RECORD_ID, configProblem, sanitizeConfig, sanitizeRecord } from "./records.ts";
import {
  MAX_RECORDS,
  type InvalidRecord,
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

const invalidKey = (entry: unknown): string =>
  `bad_${createHash("sha1")
    .update(JSON.stringify(entry) ?? "")
    .digest("hex")
    .slice(0, 10)}`;

function describeInvalid(
  def: RegisterDef,
  entry: unknown,
  reason: string,
  usableId: string | null,
): InvalidRecord {
  const values = (entry as { values?: unknown } | null)?.values;
  const title =
    typeof values === "object" && values !== null
      ? (values as Record<string, unknown>)[def.titleKey]
      : undefined;
  return {
    key: usableId ?? invalidKey(entry),
    id: usableId,
    title:
      typeof title === "string" && title.trim() !== ""
        ? title.trim().slice(0, 120)
        : "(untitled)",
    reason,
    raw: entry,
  };
}

/** Records that fail the checks are not dropped: they are returned in `invalid`, and every write puts them back
 *  into the file exactly as they were, until someone repairs or removes them. */
function parseFile(def: RegisterDef, value: unknown): RegisterFile {
  const raw =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const items: RegisterRecord[] = [];
  const invalid: InvalidRecord[] = [];
  for (const entry of Array.isArray(raw.items) ? raw.items : []) {
    const input = entry as Record<string, unknown>;
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      invalid.push(describeInvalid(def, entry, "This entry is not a record.", null));
      continue;
    }
    if (typeof input.id !== "string" || !RECORD_ID.test(input.id)) {
      invalid.push(describeInvalid(def, entry, "This entry has no usable id.", null));
      continue;
    }
    const created = typeof input.createdAt === "string" ? input.createdAt : "";
    const updated = typeof input.updatedAt === "string" ? input.updatedAt : created;
    const parsed = sanitizeRecord(
      def,
      input,
      updated || new Date(0).toISOString(),
      undefined,
      true,
    );
    if (parsed.ok) {
      items.push({ ...parsed.record, createdAt: created || parsed.record.createdAt });
    } else {
      invalid.push(describeInvalid(def, entry, parsed.reason, input.id));
    }
  }
  return {
    items,
    config: sanitizeConfig(def, raw.config),
    ...(invalid.length > 0 ? { invalid } : {}),
  };
}

export async function readRegister(
  def: RegisterDef,
  env: Env = process.env,
): Promise<RegisterFile> {
  const read = await readJsonSafe(fileOf(def, env));
  if (read.kind === "missing")
    return { items: [], config: sanitizeConfig(def, undefined) };
  if (read.kind === "corrupt") {
    throw new RegisterError(
      `The saved ${def.title} could not be read. It has not been changed. Restore it from a backup, or move the file registers\\${def.id}.json out of the app's data folder to start again.`,
      500,
    );
  }
  return parseFile(def, read.value);
}

export interface RegisterChanges {
  upsert?: unknown;
  remove?: unknown;
  config?: unknown;
}

const MAX_BATCH = 500;

export const CHANGED_ELSEWHERE =
  "This was changed elsewhere since you opened it. Close it and open it again to see the latest, then redo your change.";
export const DELETED_ELSEWHERE =
  "This was deleted elsewhere since you opened it. Close it and reload the list.";

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
    let invalid = file.invalid ?? [];
    // Which fields changed (keys only, never values), for the local history written after the save.
    const history: HistoryEntry[] = [];
    if (changes.config !== undefined) {
      const problem = configProblem(def, changes.config);
      if (problem) throw new RegisterError(problem);
    }

    if (changes.remove !== undefined) {
      if (!Array.isArray(changes.remove) || changes.remove.length > MAX_BATCH) {
        throw new RegisterError("Remove needs a list of ids.");
      }
      for (const id of changes.remove) {
        if (typeof id !== "string") continue;
        if (byId.delete(id)) history.push({ at: stamp, id, kind: "deleted" });
        else if (invalid.some((i) => i.key === id)) {
          invalid = invalid.filter((i) => i.key !== id);
          history.push({ at: stamp, id, kind: "deleted" });
        }
      }
    }
    if (changes.upsert !== undefined) {
      if (!Array.isArray(changes.upsert) || changes.upsert.length > MAX_BATCH) {
        throw new RegisterError(`Send at most ${MAX_BATCH} records at a time.`);
      }
      for (const input of changes.upsert) {
        const id = (input as { id?: unknown })?.id;
        const existing = typeof id === "string" ? byId.get(id) : undefined;
        const inInvalid = typeof id === "string" && invalid.some((i) => i.key === id);
        // Only the edit form sends the version it opened; an API or seed write without one is never refused.
        const base = (input as { baseUpdatedAt?: unknown })?.baseUpdatedAt;
        if (typeof base === "string" && base !== "") {
          if (existing && existing.updatedAt > base) {
            throw new RegisterError(CHANGED_ELSEWHERE, 409);
          }
          if (!existing && !inInvalid && typeof id === "string") {
            throw new RegisterError(DELETED_ELSEWHERE, 409);
          }
        }
        const repaired =
          existing || typeof id !== "string"
            ? undefined
            : invalid.find((i) => i.key === id && i.id !== null);
        const parsed = sanitizeRecord(def, input, stamp, existing);
        if (!parsed.ok) throw new RegisterError(parsed.reason);
        if (repaired) {
          const was = (repaired.raw as { createdAt?: unknown }).createdAt;
          if (typeof was === "string" && was) parsed.record.createdAt = was;
          invalid = invalid.filter((i) => i !== repaired);
        }
        byId.set(parsed.record.id, parsed.record);
        const entry = entryForSave(def, existing, parsed.record, stamp);
        if (entry) history.push(entry);
      }
    }
    if (byId.size > MAX_RECORDS) {
      throw new RegisterError(`A register holds at most ${MAX_RECORDS} records.`);
    }
    const config =
      changes.config !== undefined ? sanitizeConfig(def, changes.config) : file.config;
    const next: RegisterFile = {
      items: [...byId.values()],
      config,
      ...(invalid.length > 0 ? { invalid } : {}),
    };
    await writeJsonAtomic(fileOf(def, env), {
      version: 1,
      items: [...next.items, ...invalid.map((i) => i.raw)],
      config,
    });
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
      const summary = summarise(def, file.items, { today, config: file.config });
      out.push(file.invalid ? { ...summary, invalid: file.invalid.length } : summary);
    } catch {
      out.push({ id: def.id, total: 0, open: 0, late: 0, soon: 0, unreadable: true });
    }
  }
  return out;
}
