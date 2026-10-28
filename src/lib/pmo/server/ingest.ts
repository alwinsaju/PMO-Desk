// Inbox ingest: reads pmo-intake/1 JSON files that a producer (a Power
// Automate flow syncing through OneDrive, later Outlook COM) drops into a
// folder, and turns each into a pending proposal or a quarantine record.
// Polling readdir, not fs.watch: a OneDrive-synced folder delivers files in
// ways file watchers miss. Read-only toward everything except deleting the
// files it has dealt with; it sends nothing anywhere. It only ever moves a file
// that is a failed pmo-intake message (see intakeProbe.ts); any other file in
// the folder is left exactly where it is and merely counted.
import { readFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { dedupeKey, deriveSourceId, idsForKey } from "../dedupe.ts";
import { filterIntake, teamsIdsOf } from "../filter.ts";
import { looksLikeIntake } from "../intakeProbe.ts";
import { pickMatchingTodo, threadKeyOf } from "../thread.ts";
import {
  IntakeSchema,
  type Intake,
  type IntakeSummary,
  type PmoConfig,
  type Proposal,
  type Todo,
} from "../types.ts";
import type { Store } from "./store.ts";

/** A file younger than this may still be mid-write by its producer. */
export const MIN_FILE_AGE_MS = 3_000;
/** A file above this is not read at all; it is reported as too large. The body
 *  of a smaller one is shortened to MAX_BODY_CHARS. */
export const HARD_MAX_FILE_BYTES = 20_000_000;
/** Only this much of a message body is kept; `Proposal.messageShortened` says so. */
export const MAX_BODY_CHARS = 1_000_000;
/** An unparsable file is retried on this many scans before it is parked. */
export const MAX_PARSE_FAILURES = 3;

export interface ScanReport {
  at: string;
  inboxDir: string;
  /** false = first-run setup is not finished or no inbox is chosen: the scan did nothing. */
  configured: boolean;
  inboxExists: boolean;
  ingested: number;
  duplicates: number;
  filtered: number;
  rejected: number;
  /** Of `ingested`: messages that joined the thread of an open to-do and became
   *  an "update to existing to-do" card instead of a new proposal. */
  updates: number;
  /** Too new, too large or otherwise left for a later scan. */
  skipped: number;
  errors: string[];
  /** Names of files in the inbox that are not PMO messages: left untouched. */
  foreign: string[];
  /** Names of files too large to take in: left untouched. */
  oversized: string[];
  /** Names of files this scan could not read. */
  errored: string[];
}

/** Names the sync client or an editor leaves beside real files; never worth a count. */
export function isIncidentalName(name: string): boolean {
  return (
    name.startsWith(".") ||
    name.startsWith("~$") ||
    /\.(tmp|part|crdownload|partial)$/i.test(name) ||
    /^(desktop\.ini|thumbs\.db)$/i.test(name)
  );
}

function clipBody(text: string): { text: string; shortened: boolean } {
  if (text.length <= MAX_BODY_CHARS) return { text, shortened: false };
  const cut = text.charCodeAt(MAX_BODY_CHARS - 1);
  // Do not end on half of a surrogate pair.
  const end = cut >= 0xd800 && cut <= 0xdbff ? MAX_BODY_CHARS - 1 : MAX_BODY_CHARS;
  return { text: text.slice(0, end), shortened: true };
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
  /** Files that are not PMO messages, by `name:mtime:size`, so an unchanged one
   *  is not read again on every scan. Rebuilt each scan from the files still there. */
  private leftAlone = new Map<string, "foreign" | "oversized">();
  /** Repeat files already counted in `duplicatesIgnored`, so a file that cannot
   *  be removed is counted once. */
  private countedDuplicates = new Set<string>();
  private inFlight: Promise<ScanReport> | null = null;
  last: ScanReport | null = null;
  /** Exact repeats of an already-seen message dropped since the app started. */
  duplicatesIgnored = 0;

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
      configured: true,
      inboxExists: true,
      ingested: 0,
      duplicates: 0,
      filtered: 0,
      rejected: 0,
      updates: 0,
      skipped: 0,
      errors: [],
      foreign: [],
      oversized: [],
      errored: [],
    };

    let names: string[] = [];
    // Nothing is read, filtered or created until the person has finished the
    // first-run wizard and an inbox folder is chosen.
    if (config.setupComplete !== true || !dir) {
      report.configured = false;
      report.inboxExists = false;
      this.last = report;
      return report;
    }
    try {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (!entry.isFile() || isIncidentalName(entry.name)) continue;
        if (/\.json$/i.test(entry.name)) names.push(entry.name);
        else report.foreign.push(entry.name); // never touched, only counted
      }
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

    names = names.sort();
    const stillThere = new Map<string, "foreign" | "oversized">();
    for (const name of names) {
      try {
        await this.handleFile(path.join(dir, name), name, config, report, stillThere);
      } catch (error) {
        report.errors.push(`${name}: ${(error as Error).message}`);
        report.errored.push(name);
        await this.store.logIngest({
          file: name,
          outcome: "error",
          error: String(error),
        });
      }
    }
    this.leftAlone = stillThere;
    report.foreign.sort();
    this.last = report;
    return report;
  }

  /** A file that is not (or cannot be taken in as) a PMO message: report it, leave it alone. */
  private async leaveAlone(
    kind: "foreign" | "oversized",
    name: string,
    info: { size: number; mtimeMs: number },
    report: ScanReport,
    stillThere: Map<string, "foreign" | "oversized">,
  ): Promise<void> {
    stillThere.set(`${name}:${info.mtimeMs}:${info.size}`, kind);
    if (kind === "oversized") {
      report.skipped++;
      report.oversized.push(name);
    } else {
      report.foreign.push(name);
    }
    await this.once(`${kind}:${name}:${info.mtimeMs}:${info.size}`, () =>
      this.store.logIngest({
        file: name,
        outcome: kind === "oversized" ? "skipped-too-large" : "ignored-not-intake",
        bytes: info.size,
      }),
    );
  }

  private countDuplicate(signature: string): void {
    if (this.countedDuplicates.has(signature)) return;
    if (this.countedDuplicates.size > 5_000) this.countedDuplicates.clear();
    this.countedDuplicates.add(signature);
    this.duplicatesIgnored++;
  }

  private async handleFile(
    filePath: string,
    name: string,
    config: PmoConfig,
    report: ScanReport,
    stillThere: Map<string, "foreign" | "oversized">,
  ): Promise<void> {
    const info = await stat(filePath);
    if (!info.isFile()) return;
    if (info.size > HARD_MAX_FILE_BYTES) {
      await this.leaveAlone("oversized", name, info, report, stillThere);
      return;
    }
    if (this.now() - info.mtimeMs < MIN_FILE_AGE_MS) {
      report.skipped++;
      return;
    }

    const signature = `${name}:${info.mtimeMs}:${info.size}`;
    const known = this.leftAlone.get(signature);
    if (known) {
      await this.leaveAlone(known, name, info, report, stillThere);
      return;
    }

    // A read error is not the file's content: it is reported, never counted
    // towards parking.
    const text = (await readFile(filePath, "utf8")).replace(/^\uFEFF/, "");
    if (!looksLikeIntake(text)) {
      await this.leaveAlone("foreign", name, info, report, stillThere);
      return;
    }

    const failureKey = `${name}:${info.mtimeMs}`;
    let intake: Intake;
    let shortened = false;
    try {
      const parsed = IntakeSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues
            .slice(0, 5)
            .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
            .join("; "),
        );
      }
      // A blank sourceId is allowed (contract): the content hash stands in.
      intake = parsed.data.sourceId
        ? parsed.data
        : { ...parsed.data, sourceId: deriveSourceId(parsed.data) };
      const body = clipBody(intake.body.text);
      if (body.shortened) {
        shortened = true;
        intake = { ...intake, body: { ...intake.body, text: body.text } };
      }
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
      this.countDuplicate(signature);
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

    const matched = await this.store.withLock(async () => {
      let found: { todo: Todo; threadKey: string } | null = null;
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
        // Dedupe and the filter have already passed. A message in the thread of
        // an open to-do becomes an update card, not a duplicate proposal.
        found = await this.matchOpenTodo(intake);
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
          update: found
            ? {
                todoId: found.todo.id,
                todoTitle: found.todo.title,
                threadKey: found.threadKey,
                result: null,
              }
            : null,
          createdAt: nowIso,
          updatedAt: nowIso,
          ...(shortened ? { messageShortened: true } : {}),
        };
        await this.store.putProposal(proposal);
      }
      await this.store.removeQuarantine(intakeId);
      await this.store.markSeen(key, { at: nowIso, intakeId });
      return found;
    });
    await this.removeInboxFile(filePath, name);
    await this.store.logIngest({
      file: name,
      outcome: "ingested",
      intakeId,
      proposalId,
      source: intake.source,
      ...(matched ? { updateOf: matched.todo.id } : {}),
    });
    report.ingested++;
    if (matched) report.updates++;
  }

  /** The open to-do this message continues, by exact thread-key equality (see
   *  thread.ts), or null. A to-do from before phase 4 has no stored key, so it
   *  is derived from its source message when that is still on disk. */
  private async matchOpenTodo(
    intake: Intake,
  ): Promise<{ todo: Todo; threadKey: string } | null> {
    const key = threadKeyOf(intake);
    if (!key) return null;
    const candidates: { todo: Todo; key: string | null }[] = [];
    for (const todo of await this.store.listTodos()) {
      if (todo.status !== "open" || todo.source.source !== intake.source) continue;
      let todoKey = todo.source.threadKey;
      if (todoKey === null && todo.source.intakeId) {
        const raw = await this.store.readRaw(todo.source.intakeId);
        todoKey = raw ? threadKeyOf(raw.intake) : null;
      }
      candidates.push({ todo, key: todoKey });
    }
    const todo = pickMatchingTodo(key, candidates);
    return todo ? { todo, threadKey: key } : null;
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
