// Inbox ingest: reads pmo-intake/1 JSON files that a producer (a Power
// Automate flow syncing through OneDrive, later Outlook COM) drops into a
// folder, and turns each into a pending proposal or a quarantine record.
// Polling readdir, not fs.watch: a OneDrive-synced folder delivers files in
// ways file watchers miss. Read-only toward everything except deleting the
// files it has dealt with; it sends nothing anywhere.
import { readFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { dedupeKey, idsForKey } from "../dedupe.ts";
import { filterIntake, teamsIdsOf } from "../filter.ts";
import {
  IntakeSchema,
  type Intake,
  type IntakeSummary,
  type PmoConfig,
  type Proposal,
} from "../types.ts";
import type { Store } from "./store.ts";

/** A file younger than this may still be mid-write by its producer. */
export const MIN_FILE_AGE_MS = 3_000;
export const MAX_FILE_BYTES = 1_000_000;
/** An unparsable file is retried on this many scans before it is parked. */
export const MAX_PARSE_FAILURES = 3;

export interface ScanReport {
  at: string;
  inboxDir: string;
  inboxExists: boolean;
  ingested: number;
  duplicates: number;
  filtered: number;
  rejected: number;
  /** Too new, too large or otherwise left for a later scan. */
  skipped: number;
  errors: string[];
}

export function summarise(intake: Intake): IntakeSummary {
  return {
    source: intake.source,
    subject: intake.subject,
    senderName: intake.sender.name ?? null,
    senderAddress: intake.sender.address ?? null,
    receivedAt: intake.receivedAt,
    link: intake.link ?? null,
  };
}

export interface IngestorOptions {
  store: Store;
  /** Resolved per scan so a config edit takes effect without a restart. */
  inboxDir: (config: PmoConfig) => string;
  now?: () => number;
}

export class Ingestor {
  private readonly store: Store;
  private readonly inboxDir: IngestorOptions["inboxDir"];
  private readonly now: () => number;
  private failures = new Map<string, number>();
  private inFlight: Promise<ScanReport> | null = null;
  last: ScanReport | null = null;

  constructor(options: IngestorOptions) {
    this.store = options.store;
    this.inboxDir = options.inboxDir;
    this.now = options.now ?? Date.now;
  }

  /** One pass over the inbox. Concurrent calls share the pass already running. */
  scan(): Promise<ScanReport> {
    this.inFlight ??= this.run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async run(): Promise<ScanReport> {
    const config = await this.store.loadConfig();
    const dir = this.inboxDir(config);
    const report: ScanReport = {
      at: new Date(this.now()).toISOString(),
      inboxDir: dir,
      inboxExists: true,
      ingested: 0,
      duplicates: 0,
      filtered: 0,
      rejected: 0,
      skipped: 0,
      errors: [],
    };

    let names: string[];
    try {
      names = (await readdir(dir)).filter((name) => /\.json$/i.test(name));
    } catch (error) {
      // Never create the folder: it is where the producer's sync lives.
      report.inboxExists = false;
      report.errors.push(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "Inbox folder not found."
          : `Cannot read the inbox folder: ${(error as Error).message}`,
      );
      this.last = report;
      return report;
    }

    names.sort();
    for (const name of names) {
      try {
        await this.handleFile(path.join(dir, name), name, config, report);
      } catch (error) {
        report.errors.push(`${name}: ${(error as Error).message}`);
        await this.store.logIngest({
          file: name,
          outcome: "error",
          error: String(error),
        });
      }
    }
    this.last = report;
    return report;
  }

  private async handleFile(
    filePath: string,
    name: string,
    config: PmoConfig,
    report: ScanReport,
  ): Promise<void> {
    const info = await stat(filePath);
    if (!info.isFile()) return;
    if (info.size > MAX_FILE_BYTES) {
      report.skipped++;
      await this.once(`large:${name}:${info.mtimeMs}`, () =>
        this.store.logIngest({
          file: name,
          outcome: "skipped-too-large",
          bytes: info.size,
        }),
      );
      return;
    }
    if (this.now() - info.mtimeMs < MIN_FILE_AGE_MS) {
      report.skipped++;
      return;
    }

    const failureKey = `${name}:${info.mtimeMs}`;
    let intake: Intake;
    try {
      const text = (await readFile(filePath, "utf8")).replace(/^﻿/, "");
      const parsed = IntakeSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues
            .slice(0, 5)
            .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
            .join("; "),
        );
      }
      intake = parsed.data;
    } catch (error) {
      const reason =
        error instanceof SyntaxError
          ? `Not valid JSON: ${error.message}`
          : String((error as Error).message);
      const count = (this.failures.get(failureKey) ?? 0) + 1;
      this.failures.set(failureKey, count);
      if (count >= MAX_PARSE_FAILURES) {
        this.failures.delete(failureKey);
        await this.store.moveToRejected(filePath, reason);
        await this.store.logIngest({ file: name, outcome: "rejected-file", reason });
        report.rejected++;
      } else {
        report.skipped++;
        await this.store.logIngest({
          file: name,
          outcome: "unparsable",
          attempt: count,
          reason,
        });
      }
      return;
    }
    this.failures.delete(failureKey);

    const key = dedupeKey(intake);
    const { intakeId, proposalId } = idsForKey(key);

    if (await this.store.hasSeen(key)) {
      await this.removeInboxFile(filePath, name);
      await this.store.logIngest({ file: name, outcome: "duplicate", intakeId });
      report.duplicates++;
      return;
    }

    const verdict = filterIntake(intake, config);
    const summary = summarise(intake);
    const nowIso = new Date(this.now()).toISOString();

    if (!verdict.pass) {
      // Metadata and reason only: the body of a filtered message is dropped.
      // Not added to the dedupe index, so allowlisting its tenant and sending
      // the message again can still get it through.
      await this.store.writeQuarantine({
        id: intakeId,
        at: nowIso,
        code: verdict.code,
        reason: verdict.reason,
        summary,
        tenantId: teamsIdsOf(intake).tenantId ?? null,
        chatId: teamsIdsOf(intake).chatId ?? null,
      });
      await this.removeInboxFile(filePath, name);
      await this.store.logIngest({
        file: name,
        outcome: "filtered",
        intakeId,
        code: verdict.code,
        source: intake.source,
      });
      report.filtered++;
      return;
    }

    await this.store.withLock(async () => {
      await this.store.writeRaw({
        intakeId,
        dedupeKey: key,
        fileName: name,
        ingestedAt: nowIso,
        intake,
      });
      // Ids are derived from the key, so a crash between these writes and the
      // retry that follows just rewrites the same files; the proposal is only
      // created if it isn't there yet, so a retry never resets a live one.
      if (!(await this.store.getProposal(proposalId))) {
        const proposal: Proposal = {
          id: proposalId,
          intakeId,
          status: "pending",
          summary,
          draft: null,
          edits: null,
          isActionable: null,
          confidence: null,
          quoteVerified: null,
          ai: { model: null, durationMs: null, attempts: 0, error: null },
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        await this.store.putProposal(proposal);
      }
      await this.store.removeQuarantine(intakeId);
      await this.store.markSeen(key, { at: nowIso, intakeId });
    });
    await this.removeInboxFile(filePath, name);
    await this.store.logIngest({
      file: name,
      outcome: "ingested",
      intakeId,
      proposalId,
      source: intake.source,
    });
    report.ingested++;
  }

  /** The file has been dealt with; remove it. If it can't be removed (a sync
   *  client holding it) the next scan sees a duplicate and tries again. */
  private async removeInboxFile(filePath: string, name: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      await this.store.logIngest({
        file: name,
        outcome: "delete-failed",
        error: String(error),
      });
    }
  }

  private logged = new Set<string>();
  private async once(key: string, fn: () => Promise<unknown>): Promise<void> {
    if (this.logged.has(key)) return;
    this.logged.add(key);
    await fn();
  }
}
