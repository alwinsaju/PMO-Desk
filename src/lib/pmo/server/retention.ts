// Retention: what the PMO app deletes, and when. Run from ensureIngest once on
// server start and then daily; every pass is idempotent (a second run right
// after the first deletes nothing). Server only.
//
//   logs/ingest.jsonl, logs/ai-calls.jsonl  lines older than retentionDays
//   rejected-files/                         older than 30 days (they may hold text)
//   quarantine/                             older than 30 days (metadata only)
//   raw/<id>.json (the message text)        only for a CLOSED to-do (done or
//       cancelled) or a REJECTED proposal, once the decision is older than
//       retentionDays. Never for an open to-do, and never for a proposal that
//       is still undecided.
//   queue/ -> archive/queue    approved or rejected proposals older than 30 days
//   todos/ -> archive/todos    done or cancelled to-dos older than 30 days
//       (moved, never deleted, so the live folders and every poll stay small;
//       reports and the raw-text rule above still read the archive)
//
// Not touched: reports/ (saved weekly reports: a person deletes those),
// audit.jsonl (the accountability trail), config, open to-dos,
// the proposal and to-do records' content. state/seen.json (hashes only; it is
// what keeps a deleted message from being re-imported as new) loses entries
// older than retentionDays, with the archived proposals of those messages,
// unless the message is still in the queue, behind an open to-do, or its text
// is still stored.
//
// A log is rewritten with a temp file and a rename. A line appended between
// the read and the rename is lost; these are diagnostic logs, so that is
// accepted rather than taking a lock on every append.
import { readFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_RETENTION_DAYS, type Proposal } from "../types.ts";
import { writeTextAtomic } from "./fsx.ts";
import type { Store } from "./store.ts";

export const QUARANTINE_MAX_AGE_DAYS = 30;
export const REJECTED_FILES_MAX_AGE_DAYS = 30;
export const ARCHIVE_AFTER_DAYS = 30;
export const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PurgeReport {
  at: string;
  retentionDays: number;
  logLinesDropped: number;
  rejectedFilesDeleted: number;
  quarantineDeleted: number;
  rawDeleted: number;
  proposalsArchived: number;
  todosArchived: number;
  /** Dedupe entries (state/seen.json) older than the retention window. */
  seenPruned: number;
  /** Archived proposals of those messages, deleted with them. */
  archivedProposalsDeleted: number;
  /** Raw snapshots kept on purpose, by reason. */
  rawKept: { openTodo: number; undecided: number; unknown: number };
  errors: string[];
}

/** Drop JSONL lines whose `ts` is before `cutoff`. Lines without a readable
 *  ts are kept. Returns how many lines were dropped. */
async function pruneJsonl(file: string, cutoff: number): Promise<number> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  const kept: string[] = [];
  let dropped = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let ts = Number.NaN;
    try {
      ts = Date.parse((JSON.parse(line) as { ts?: string }).ts ?? "");
    } catch {
      // keep a line we cannot read
    }
    if (!Number.isNaN(ts) && ts < cutoff) dropped++;
    else kept.push(line);
  }
  if (dropped > 0) await writeTextAtomic(file, kept.length ? `${kept.join("\n")}\n` : "");
  return dropped;
}

/** moveToRejected names files `<2026-10-24T10-11-12-345Z>_<name>` (and a
 *  `.reason.txt` beside it); that stamp is when it was parked. The file's own
 *  mtime is the fallback, but it is the producer's, so it comes second. */
function parkedAt(name: string, mtimeMs: number): number {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_/.exec(name);
  if (match) {
    const parsed = Date.parse(
      `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`,
    );
    if (!Number.isNaN(parsed)) return parsed;
  }
  return mtimeMs;
}

export async function purgeExpired(
  store: Store,
  options: { now: Date; retentionDays?: number },
): Promise<PurgeReport> {
  const retentionDays =
    options.retentionDays !== undefined && options.retentionDays > 0
      ? options.retentionDays
      : DEFAULT_RETENTION_DAYS;
  const nowMs = options.now.getTime();
  const retentionCutoff = nowMs - retentionDays * DAY_MS;
  const shortCutoff = (days: number) => nowMs - Math.min(days, retentionDays) * DAY_MS;

  const report: PurgeReport = {
    at: options.now.toISOString(),
    retentionDays,
    logLinesDropped: 0,
    rejectedFilesDeleted: 0,
    quarantineDeleted: 0,
    rawDeleted: 0,
    proposalsArchived: 0,
    todosArchived: 0,
    seenPruned: 0,
    archivedProposalsDeleted: 0,
    rawKept: { openTodo: 0, undecided: 0, unknown: 0 },
    errors: [],
  };
  const attempt = async (what: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      report.errors.push(`${what}: ${(error as Error).message}`);
    }
  };

  await attempt("logs", async () => {
    for (const file of [store.paths.ingestLog, store.paths.aiCallsLog]) {
      report.logLinesDropped += await pruneJsonl(file, retentionCutoff);
    }
  });

  await attempt("rejected-files", async () => {
    const dir = store.paths.rejectedFiles;
    const cutoff = shortCutoff(REJECTED_FILES_MAX_AGE_DAYS);
    let names: string[] = [];
    try {
      names = await readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const name of names) {
      const file = path.join(dir, name);
      const info = await stat(file).catch(() => null);
      if (!info?.isFile() || parkedAt(name, info.mtimeMs) >= cutoff) continue;
      await unlink(file);
      if (!name.endsWith(".reason.txt")) report.rejectedFilesDeleted++;
    }
  });

  await attempt("quarantine", async () => {
    const cutoff = shortCutoff(QUARANTINE_MAX_AGE_DAYS);
    for (const record of await store.listQuarantine()) {
      const at = Date.parse(record.at);
      if (Number.isNaN(at) || at >= cutoff) continue;
      await store.removeQuarantine(record.id);
      report.quarantineDeleted++;
    }
  });

  await attempt("raw", () =>
    store.withLock(async () => {
      const [raws, live, archived, todos] = await Promise.all([
        store.listRaw(),
        store.listProposals(),
        store.listArchivedProposals(),
        store.listAllTodos(),
      ]);
      const proposals = [...live, ...archived];
      // A message that held several tasks has several proposals: it counts as
      // undecided while any of them is, otherwise by the latest decision.
      const proposalByIntake = new Map<string, Proposal>();
      for (const p of proposals) {
        const seen = proposalByIntake.get(p.intakeId);
        const decided = (q: Proposal) =>
          q.status === "approved" || q.status === "rejected";
        if (
          !seen ||
          (decided(seen) && !decided(p)) ||
          (decided(seen) === decided(p) && p.updatedAt > seen.updatedAt)
        ) {
          proposalByIntake.set(p.intakeId, p);
        }
      }
      const todoById = new Map(todos.map((t) => [t.id, t]));
      const openIntakes = new Set(
        todos.filter((t) => t.status === "open").map((t) => t.source.intakeId),
      );

      for (const raw of raws) {
        const proposal = proposalByIntake.get(raw.intakeId);
        if (openIntakes.has(raw.intakeId)) {
          report.rawKept.openTodo++;
          continue;
        }
        if (!proposal) {
          report.rawKept.unknown++;
          continue;
        }

        let decidedAt: string | null | undefined;
        if (proposal.status === "rejected") {
          decidedAt = proposal.updatedAt;
        } else if (proposal.status === "approved") {
          const todo = proposal.todoId ? todoById.get(proposal.todoId) : undefined;
          if (!todo) {
            report.rawKept.unknown++;
            continue;
          }
          if (todo.status === "open") {
            report.rawKept.openTodo++;
            continue;
          }
          decidedAt = todo.completedAt ?? todo.updatedAt;
        } else {
          report.rawKept.undecided++;
          continue;
        }

        const decided = Date.parse(decidedAt ?? "");
        if (Number.isNaN(decided) || decided >= retentionCutoff) continue;
        await store.removeRaw(raw.intakeId);
        report.rawDeleted++;
      }
    }),
  );

  await attempt("archive", () =>
    store.withLock(async () => {
      const cutoff = nowMs - ARCHIVE_AFTER_DAYS * DAY_MS;
      const older = (iso: string | null | undefined) => {
        const at = Date.parse(iso ?? "");
        return !Number.isNaN(at) && at < cutoff;
      };
      for (const proposal of await store.listProposals()) {
        const decided = proposal.status === "approved" || proposal.status === "rejected";
        if (!decided || !older(proposal.updatedAt)) continue;
        await store.archiveRecord("queue", proposal.id);
        report.proposalsArchived++;
      }
      for (const todo of await store.listTodos()) {
        if (todo.status === "open" || !older(todo.completedAt ?? todo.updatedAt))
          continue;
        await store.archiveRecord("todos", todo.id);
        report.todosArchived++;
      }
    }),
  );

  // The dedupe index must not grow for ever: a message first seen longer ago
  // than the retention window can be imported again as new. Entries whose
  // message is still in the queue or behind an open to-do are kept.
  await attempt("dedupe", () =>
    store.withLock(async () => {
      const [live, archived, todos, raws] = await Promise.all([
        store.listProposals(),
        store.listArchivedProposals(),
        store.listAllTodos(),
        store.listRaw(),
      ]);
      // A message whose text is still stored (it follows the raw-text rule
      // above) keeps its record and its entry until the text is gone.
      const inUse = new Set<string>([
        ...live.map((p) => p.intakeId),
        ...raws.map((r) => r.intakeId),
      ]);
      for (const todo of todos) {
        if (todo.status === "open" && todo.source.intakeId)
          inUse.add(todo.source.intakeId);
      }
      const dropped = new Set(
        await store.pruneSeen((entry) => {
          const at = Date.parse(entry.at);
          return !Number.isNaN(at) && at < retentionCutoff && !inUse.has(entry.intakeId);
        }),
      );
      report.seenPruned = dropped.size;
      for (const proposal of archived) {
        const at = Date.parse(proposal.updatedAt);
        if (!dropped.has(proposal.intakeId) || Number.isNaN(at) || at >= retentionCutoff)
          continue;
        await store.removeArchivedProposal(proposal.id);
        report.archivedProposalsDeleted++;
      }
    }),
  );

  const changed =
    report.seenPruned +
    report.archivedProposalsDeleted +
    report.logLinesDropped +
    report.rejectedFilesDeleted +
    report.quarantineDeleted +
    report.rawDeleted +
    report.proposalsArchived +
    report.todosArchived;
  if (changed > 0 || report.errors.length > 0) {
    await store.logIngest({
      ts: report.at,
      outcome: "purge",
      retentionDays,
      logLinesDropped: report.logLinesDropped,
      rejectedFilesDeleted: report.rejectedFilesDeleted,
      quarantineDeleted: report.quarantineDeleted,
      rawDeleted: report.rawDeleted,
      proposalsArchived: report.proposalsArchived,
      todosArchived: report.todosArchived,
      seenPruned: report.seenPruned,
      archivedProposalsDeleted: report.archivedProposalsDeleted,
      errors: report.errors,
    });
  }
  return report;
}
