// File-backed storage for the PMO app: one JSON file per record, written
// atomically. The methods here are plain read/write primitives; anything that
// reads, decides and writes back goes through `withLock`, which serialises
// those sequences in this process.
import os from "node:os";
import { z } from "zod";
import { mkdir, unlink, writeFile } from "node:fs/promises";
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
  listFiles,
  moveFile,
  mutexFor,
  readJson,
  writeJsonAtomic,
  type Mutex,
} from "./fsx.ts";
import { isSafeId, migratedInboxDir, pmoPaths, type PmoPaths } from "./paths.ts";

export interface SeenEntry {
  at: string;
  intakeId: string;
}

export type AuditAction =
  | "approve"
  | "reject"
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
  | "chaser-draft"
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

export class Store {
  readonly paths: PmoPaths;
  private readonly mutex: Mutex;
  private seen: Record<string, SeenEntry> | null = null;
  /** Records skipped because their file was unreadable; surfaced in state. */
  corruptFiles = 0;
  /** The one-time inbox path migration, run on first config load (see loadConfig). */
  private inboxMigration: Promise<void> | null = null;

  readonly root: string;

  constructor(root: string) {
    this.root = root;
    this.paths = pmoPaths(root);
    this.mutex = mutexFor(root);
  }

  withLock<T>(fn: () => Promise<T>): Promise<T> {
    return this.mutex.run(fn);
  }

  async init(): Promise<void> {
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
      await writeJsonAtomic(p.config, PmoConfigSchema.parse({}));
    }
  }

  // --- config ---------------------------------------------------------------

  /** If config.json still holds a former default inboxDir (first run wrote the
   *  then-default into it, which would override the new one), swap in the current
   *  default and persist. Only an exact match of a known old default (loosely
   *  compared) is touched; a custom path never is. Unknown keys are kept as they
   *  are. Runs once per Store; a failed attempt is retried on the next load. */
  private migrateInboxDir(): Promise<void> {
    this.inboxMigration ??= (async () => {
      try {
        const raw = await readJson<Record<string, unknown>>(this.paths.config);
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          this.inboxMigration = null; // no config file yet: check again once it exists
          return;
        }
        const next = migratedInboxDir(raw.inboxDir);
        if (next === null) return;
        await writeJsonAtomic(this.paths.config, { ...raw, inboxDir: next });
        await this.audit("config", {
          migrated: "inboxDir",
          from: String(raw.inboxDir),
          to: next,
        });
      } catch {
        this.inboxMigration = null; // unreadable or unwritable now; try again next load
      }
    })();
    return this.inboxMigration;
  }

  async loadConfig(): Promise<PmoConfig> {
    await this.migrateInboxDir();
    try {
      return PmoConfigSchema.parse((await readJson(this.paths.config)) ?? {});
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

  private async readAll<T>(
    dir: string,
    parse: (value: unknown) => { success: boolean; data?: T },
  ): Promise<T[]> {
    const out: T[] = [];
    for (const name of await listFiles(dir)) {
      try {
        const result = parse(await readJson(path.join(dir, name)));
        if (result.success && result.data !== undefined) out.push(result.data);
        else this.corruptFiles++;
      } catch {
        this.corruptFiles++;
      }
    }
    return out;
  }

  private async readOne<T>(
    dir: string,
    id: string,
    parse: (value: unknown) => { success: boolean; data?: T },
  ): Promise<T | null> {
    if (!isSafeId(id)) return null;
    const value = await readJson(path.join(dir, `${id}.json`));
    if (value === null) return null;
    const result = parse(value);
    return result.success && result.data !== undefined ? result.data : null;
  }

  // --- raw snapshots (immutable) ----------------------------------------------

  async writeRaw(record: RawRecord): Promise<void> {
    await writeJsonAtomic(path.join(this.paths.raw, `${record.intakeId}.json`), record);
  }

  readRaw(intakeId: string): Promise<RawRecord | null> {
    return this.readOne(this.paths.raw, intakeId, (v) => RawRecordSchema.safeParse(v));
  }

  async listRaw(): Promise<RawRecord[]> {
    return this.readAll(this.paths.raw, (v) => RawRecordSchema.safeParse(v));
  }

  async removeRaw(intakeId: string): Promise<void> {
    if (!isSafeId(intakeId)) return;
    await unlink(path.join(this.paths.raw, `${intakeId}.json`)).catch(() => undefined);
  }

  // --- quarantine -------------------------------------------------------------

  async writeQuarantine(record: QuarantineRecord): Promise<void> {
    await writeJsonAtomic(path.join(this.paths.quarantine, `${record.id}.json`), record);
  }

  async removeQuarantine(id: string): Promise<void> {
    if (!isSafeId(id)) return;
    await unlink(path.join(this.paths.quarantine, `${id}.json`)).catch(() => undefined);
  }

  async listQuarantine(): Promise<QuarantineRecord[]> {
    const all = await this.readAll(this.paths.quarantine, (v) =>
      QuarantineRecordSchema.safeParse(v),
    );
    return all.sort((a, b) => b.at.localeCompare(a.at));
  }

  // --- proposals (queue/) -----------------------------------------------------

  async putProposal(proposal: Proposal): Promise<void> {
    await writeJsonAtomic(path.join(this.paths.queue, `${proposal.id}.json`), proposal);
  }

  getProposal(id: string): Promise<Proposal | null> {
    return this.readOne(this.paths.queue, id, (v) => ProposalSchema.safeParse(v));
  }

  async listProposals(): Promise<Proposal[]> {
    const all = await this.readAll(this.paths.queue, (v) => ProposalSchema.safeParse(v));
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // --- todos ------------------------------------------------------------------

  async putTodo(todo: Todo): Promise<void> {
    await writeJsonAtomic(path.join(this.paths.todos, `${todo.id}.json`), todo);
  }

  getTodo(id: string): Promise<Todo | null> {
    return this.readOne(this.paths.todos, id, (v) => TodoSchema.safeParse(v));
  }

  async listTodos(): Promise<Todo[]> {
    return this.readAll(this.paths.todos, (v) => TodoSchema.safeParse(v));
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
    seen[key] = entry;
    await writeJsonAtomic(this.paths.seen, seen);
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
    return appendJsonl(this.paths.audit, {
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
