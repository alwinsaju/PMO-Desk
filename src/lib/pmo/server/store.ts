// File-backed storage for the PMO app: one JSON file per record, written
// atomically. The methods here are plain read/write primitives; anything that
// reads, decides and writes back goes through `withLock`, which serialises
// those sequences in this process.
import os from "node:os";
import { z } from "zod";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PmoConfigSchema,
  ProposalSchema,
  QuarantineRecordSchema,
  RawRecordSchema,
  TodoSchema,
  type PmoConfig,
  type Proposal,
  type QuarantineRecord,
  type RawRecord,
  type Todo,
} from "../types.ts";
import {
  appendJsonl,
  appendJsonlRotating,
  listFiles,
  mapLimit,
  moveFile,
  mutexFor,
  readJson,
  readJsonSafe,
  writeJsonAtomic,
  type Mutex,
} from "./fsx.ts";
import { migrateProposal, migrateTodo } from "./migrate.ts";
import { isSafeId, pmoPaths, type PmoPaths } from "./paths.ts";
import { inferSetupComplete } from "../firstRun.ts";

/** Record files read at once when a folder is listed. */
const READ_CONCURRENCY = 16;

export interface SeenEntry {
  at: string;
  intakeId: string;
}

export type AuditAction =
  | "approve"
  | "reject"
  | "restore"
  | "edit"
  | "complete"
  | "cancel"
  | "reopen"
  | "create-manual"
  | "retry"
  | "paste"
  | "snooze"
  | "waiting"
  | "update-apply"
  | "update-separate"
  | "split"
  | "chaser-draft"
  | "signoff-request"
  | "signoff-record"
  | "signoff-conditions-met"
  | "signoff-revoke"
  | "signoff-draft"
  | "signoff-refused"
  | "report-generate"
  | "report-narrative"
  | "report-save"
  | "config";

/** state/notify.json: reminders already delivered (by key) and the claims that
 *  are out with a client but not yet acknowledged. */
export const NotifyStateSchema = z.object({
  delivered: z
    .record(
      z.string(),
      z.object({
        at: z.string(),
        kind: z.string(),
        todoId: z.string().nullable(),
        client: z.string(),
      }),
    )
    .default({}),
  claims: z
    .record(
      z.string(),
      z.object({
        at: z.string(),
        client: z.string(),
        keys: z.array(
          z.object({ key: z.string(), kind: z.string(), todoId: z.string().nullable() }),
        ),
      }),
    )
    .default({}),
});
export type NotifyState = z.output<typeof NotifyStateSchema>;

type Parse<T> = (value: unknown) => { success: boolean; data?: T };

/** Which record directory a file came from; names the folder under corrupt/. */
type RecordKind =
  "raw" | "quarantine" | "queue" | "todos" | "archive-queue" | "archive-todos";

interface CacheEntry {
  mtimeMs: number;
  size: number;
  value: unknown;
}

export class Store {
  readonly paths: PmoPaths;
  private readonly mutex: Mutex;
  private seen: Record<string, SeenEntry> | null = null;
  /** Records moved to corrupt/ by this process (the folder itself is the
   *  durable count: see listCorrupt). */
  corruptFiles = 0;
  /** Parsed records by path, valid while (mtimeMs, size) are unchanged, so a
   *  poll re-reads only the files that changed. */
  private readonly cache = new Map<string, CacheEntry>();
  /** Files actually read from disk (cache misses); exposed for tests. */
  readonly stats = { fileReads: 0 };

  readonly root: string;

  constructor(root: string) {
    this.root = root;
    this.paths = pmoPaths(root);
    this.mutex = mutexFor(root);
  }

  withLock<T>(fn: () => Promise<T>): Promise<T> {
    return this.mutex.run(fn);
  }

  /** `seed` is the config written when none exists yet (tests; production starts neutral). */
  async init(seed?: PmoConfig): Promise<void> {
    const p = this.paths;
    await Promise.all(
      [
        p.raw,
        p.quarantine,
        p.rejectedFiles,
        p.queue,
        p.todos,
        p.reports,
        path.dirname(p.seen),
      ].map((dir) => mkdir(dir, { recursive: true })),
    );
    // Write the defaults out once so the file is there to edit by hand.
    if ((await readJson(p.config)) === null) {
      await writeJsonAtomic(p.config, seed ?? PmoConfigSchema.parse({}));
    }
  }

  // --- config ---------------------------------------------------------------

  async loadConfig(): Promise<PmoConfig> {
    try {
      const raw = (await readJson(this.paths.config)) ?? {};
      // A file from before the first-run wizard counts as set up when it already
      // has an owner email and an inbox (see inferSetupComplete).
      const saved =
        typeof raw === "object" && !Array.isArray(raw)
          ? { ...raw, setupComplete: inferSetupComplete(raw) }
          : raw;
      return PmoConfigSchema.parse(saved);
    } catch {
      // A hand-edit gone wrong must not stop ingest; fall back to the
      // defaults (which are the strict ones) until the file is fixed.
      return PmoConfigSchema.parse({});
    }
  }

  async saveConfig(config: PmoConfig): Promise<void> {
    await writeJsonAtomic(this.paths.config, config);
  }

  // --- reminder delivery state --------------------------------------------------

  async loadNotify(): Promise<NotifyState> {
    try {
      return NotifyStateSchema.parse((await readJson(this.paths.notify)) ?? {});
    } catch {
      // Unreadable: start clean. The worst case is one repeated reminder.
      return NotifyStateSchema.parse({});
    }
  }

  async saveNotify(state: NotifyState): Promise<void> {
    await writeJsonAtomic(this.paths.notify, state);
  }

  // --- generic record dirs ----------------------------------------------------

  /** Move a record file that cannot be read or validated to
   *  corrupt/<kind>/<name>.<timestamp>. Never deleted. */
  private async quarantineFile(
    file: string,
    kind: RecordKind,
    reason: string,
  ): Promise<void> {
    this.cache.delete(file);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    try {
      await moveFile(
        file,
        path.join(this.paths.corrupt, kind, `${path.basename(file)}.${stamp}`),
      );
    } catch (error) {
      // Another reader got there first; anything else leaves the file in place.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      this.corruptFiles++;
      return;
    }
    this.corruptFiles++;
    await this.logIngest({
      outcome: "record-quarantined",
      kind,
      file: path.basename(file),
      reason: reason.slice(0, 300),
    });
  }

  /** One record file: from the cache when (mtimeMs, size) are unchanged, else
   *  read, migrated to the current shape and validated. Unparsable or invalid
   *  content quarantines the file; an I/O error (a locked file) skips it for
   *  now without moving it. undefined = nothing to return. */
  private async loadRecord<T>(
    file: string,
    kind: RecordKind,
    parse: Parse<T>,
  ): Promise<T | undefined> {
    let info;
    try {
      info = await stat(file);
    } catch (error) {
      this.cache.delete(file);
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.corruptFiles++;
      return undefined;
    }
    const cached = this.cache.get(file);
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
      return structuredClone(cached.value) as T;
    }
    this.stats.fileReads++;
    let read;
    try {
      read = await readJsonSafe(file);
    } catch {
      this.corruptFiles++;
      return undefined;
    }
    if (read.kind === "missing") {
      this.cache.delete(file);
      return undefined;
    }
    if (read.kind === "corrupt") {
      await this.quarantineFile(file, kind, read.reason);
      return undefined;
    }
    const migrate =
      kind === "queue" || kind === "archive-queue"
        ? migrateProposal
        : kind === "todos" || kind === "archive-todos"
          ? migrateTodo
          : (value: unknown) => value;
    const result = parse(migrate(read.value));
    if (!result.success || result.data === undefined) {
      await this.quarantineFile(file, kind, "does not match the record format");
      return undefined;
    }
    this.cache.set(file, { mtimeMs: info.mtimeMs, size: info.size, value: result.data });
    return structuredClone(result.data);
  }

  private async readAll<T>(dir: string, kind: RecordKind, parse: Parse<T>): Promise<T[]> {
    const names = await listFiles(dir);
    const live = new Set<string>();
    const files = names.map((name) => {
      const file = path.join(dir, name);
      live.add(file);
      return file;
    });
    // Bounded parallelism: a first read of a big folder is mostly waiting on the disk.
    const records = await mapLimit(files, READ_CONCURRENCY, (file) =>
      this.loadRecord(file, kind, parse),
    );
    const out = records.filter((record): record is T => record !== undefined);
    for (const key of this.cache.keys()) {
      if (path.dirname(key) === dir && !live.has(key)) this.cache.delete(key);
    }
    return out;
  }

  private async readOne<T>(
    dir: string,
    id: string,
    kind: RecordKind,
    parse: Parse<T>,
  ): Promise<T | null> {
    if (!isSafeId(id)) return null;
    return (await this.loadRecord(path.join(dir, `${id}.json`), kind, parse)) ?? null;
  }

  /** Write a record and forget what was cached for it. */
  private async writeRecord(file: string, value: unknown): Promise<void> {
    this.cache.delete(file);
    await writeJsonAtomic(file, value);
    this.cache.delete(file);
  }

  /** Record files moved aside as unreadable, as `<kind>/<file>`, oldest first. */
  async listCorrupt(): Promise<string[]> {
    const names: string[] = [];
    let kinds: string[] = [];
    try {
      kinds = await readdir(this.paths.corrupt);
    } catch {
      return [];
    }
    for (const kind of kinds) {
      try {
        for (const name of await readdir(path.join(this.paths.corrupt, kind))) {
          names.push(`${kind}/${name}`);
        }
      } catch {
        // not a directory
      }
    }
    const stampOf = (name: string) => name.slice(name.lastIndexOf(".") + 1);
    return names.sort((a, b) => stampOf(a).localeCompare(stampOf(b)));
  }

  // --- raw snapshots (immutable) ----------------------------------------------

  async writeRaw(record: RawRecord): Promise<void> {
    await this.writeRecord(path.join(this.paths.raw, `${record.intakeId}.json`), record);
  }

  readRaw(intakeId: string): Promise<RawRecord | null> {
    return this.readOne(this.paths.raw, intakeId, "raw", (v) =>
      RawRecordSchema.safeParse(v),
    );
  }

  async listRaw(): Promise<RawRecord[]> {
    return this.readAll(this.paths.raw, "raw", (v) => RawRecordSchema.safeParse(v));
  }

  async removeRaw(intakeId: string): Promise<void> {
    if (!isSafeId(intakeId)) return;
    const file = path.join(this.paths.raw, `${intakeId}.json`);
    this.cache.delete(file);
    await unlink(file).catch(() => undefined);
  }

  // --- quarantine -------------------------------------------------------------

  async writeQuarantine(record: QuarantineRecord): Promise<void> {
    await this.writeRecord(path.join(this.paths.quarantine, `${record.id}.json`), record);
  }

  async removeQuarantine(id: string): Promise<void> {
    if (!isSafeId(id)) return;
    const file = path.join(this.paths.quarantine, `${id}.json`);
    this.cache.delete(file);
    await unlink(file).catch(() => undefined);
  }

  async listQuarantine(): Promise<QuarantineRecord[]> {
    const all = await this.readAll(this.paths.quarantine, "quarantine", (v) =>
      QuarantineRecordSchema.safeParse(v),
    );
    return all.sort((a, b) => b.at.localeCompare(a.at));
  }

  // --- proposals (queue/) -----------------------------------------------------

  async putProposal(proposal: Proposal): Promise<void> {
    await this.writeRecord(path.join(this.paths.queue, `${proposal.id}.json`), proposal);
  }

  getProposal(id: string): Promise<Proposal | null> {
    return this.readOne(this.paths.queue, id, "queue", (v) =>
      ProposalSchema.safeParse(v),
    );
  }

  async listProposals(): Promise<Proposal[]> {
    const all = await this.readAll(this.paths.queue, "queue", (v) =>
      ProposalSchema.safeParse(v),
    );
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Decided proposals moved out of queue/ by the retention sweep. */
  listArchivedProposals(): Promise<Proposal[]> {
    return this.readAll(this.paths.archiveQueue, "archive-queue", (v) =>
      ProposalSchema.safeParse(v),
    );
  }

  // --- todos ------------------------------------------------------------------

  async putTodo(todo: Todo): Promise<void> {
    await this.writeRecord(path.join(this.paths.todos, `${todo.id}.json`), todo);
  }

  getTodo(id: string): Promise<Todo | null> {
    return this.readOne(this.paths.todos, id, "todos", (v) => TodoSchema.safeParse(v));
  }

  async listTodos(): Promise<Todo[]> {
    return this.readAll(this.paths.todos, "todos", (v) => TodoSchema.safeParse(v));
  }

  /** Closed to-dos moved out of todos/ by the retention sweep. */
  listArchivedTodos(): Promise<Todo[]> {
    return this.readAll(this.paths.archiveTodos, "archive-todos", (v) =>
      TodoSchema.safeParse(v),
    );
  }

  /** Live and archived to-dos together (reports and retention need the history). */
  async listAllTodos(): Promise<Todo[]> {
    return [...(await this.listTodos()), ...(await this.listArchivedTodos())];
  }

  /** Move a decided proposal / closed to-do into archive/ (callers hold the lock). */
  async archiveRecord(kind: "queue" | "todos", id: string): Promise<void> {
    if (!isSafeId(id)) return;
    const from = path.join(
      kind === "queue" ? this.paths.queue : this.paths.todos,
      `${id}.json`,
    );
    const to = path.join(
      kind === "queue" ? this.paths.archiveQueue : this.paths.archiveTodos,
      `${id}.json`,
    );
    this.cache.delete(from);
    await moveFile(from, to);
  }

  // --- dedupe index -----------------------------------------------------------

  private async loadSeen(): Promise<Record<string, SeenEntry>> {
    if (!this.seen) {
      try {
        this.seen = (await readJson<Record<string, SeenEntry>>(this.paths.seen)) ?? {};
      } catch {
        this.seen = {};
      }
    }
    return this.seen;
  }

  async hasSeen(key: string): Promise<boolean> {
    return key in (await this.loadSeen());
  }

  async markSeen(key: string, entry: SeenEntry): Promise<void> {
    const seen = await this.loadSeen();
    if (seen[key]?.intakeId === entry.intakeId) return; // nothing to write
    seen[key] = entry;
    await writeJsonAtomic(this.paths.seen, seen);
  }

  /** Drop the dedupe entries `shouldDrop` picks (callers hold the lock); returns
   *  the intake ids that went. */
  async pruneSeen(shouldDrop: (entry: SeenEntry) => boolean): Promise<string[]> {
    const seen = await this.loadSeen();
    const dropped: string[] = [];
    for (const [key, entry] of Object.entries(seen)) {
      if (!shouldDrop(entry)) continue;
      delete seen[key];
      dropped.push(entry.intakeId);
    }
    if (dropped.length > 0) await writeJsonAtomic(this.paths.seen, seen);
    return dropped;
  }

  /** Delete one archived proposal (retention only). */
  async removeArchivedProposal(id: string): Promise<void> {
    if (!isSafeId(id)) return;
    const file = path.join(this.paths.archiveQueue, `${id}.json`);
    this.cache.delete(file);
    await unlink(file).catch(() => undefined);
  }

  // --- rejected producer files, logs, audit -----------------------------------

  /** Park an unparsable inbox file (plus a .reason.txt) so it stops being retried. */
  async moveToRejected(sourcePath: string, reason: string): Promise<string> {
    const base = path.basename(sourcePath);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = path.join(this.paths.rejectedFiles, `${stamp}_${base}`);
    await moveFile(sourcePath, target);
    await writeFile(`${target}.reason.txt`, `${reason}\n`, "utf8");
    return target;
  }

  async countRejectedFiles(): Promise<number> {
    return (await listFiles(this.paths.rejectedFiles, ".reason.txt")).length;
  }

  /** The parked producer files: how many, and the newest `limit` by their
   *  original name (the timestamp moveToRejected put in front is dropped). */
  async listRejectedFiles(limit: number): Promise<{ count: number; names: string[] }> {
    const reasons = await listFiles(this.paths.rejectedFiles, ".reason.txt");
    const names = reasons
      .sort()
      .reverse()
      .slice(0, limit)
      .map((name) =>
        name
          .replace(/\.reason\.txt$/i, "")
          .replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_/, ""),
      );
    return { count: reasons.length, names };
  }

  logIngest(entry: Record<string, unknown>): Promise<void> {
    return appendJsonl(this.paths.ingestLog, {
      ts: new Date().toISOString(),
      ...entry,
    }).catch(() => undefined);
  }

  logAiCall(entry: Record<string, unknown>): Promise<void> {
    return appendJsonl(this.paths.aiCallsLog, {
      ts: new Date().toISOString(),
      ...entry,
    }).catch(() => undefined);
  }

  audit(action: AuditAction, details: Record<string, unknown>): Promise<void> {
    return appendJsonlRotating(this.paths.audit, {
      ts: new Date().toISOString(),
      action,
      user: osUser(),
      ...details,
    }).catch(() => undefined);
  }
}

export function osUser(): string {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USERNAME ?? "unknown";
  }
}
