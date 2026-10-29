// The PTO email hand-over, server side. A Power Automate flow (docs/pto-email-flow.md)
// writes one file per email into the PTO-Inbox folder in OneDrive; a scan reads each
// one, asks the local AI what it says (PTO, comp off, sick leave ...), files the leave
// as approved Time off for the sender and records what was done. Anything doubtful is
// kept for a person. OneDrive carries the files; mail that arrives while the app is
// closed is handled at the next scan.
import { statSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { mutexFor, readJsonSafe, writeJsonAtomic } from "../pmo/server/fsx.ts";
import { aiOsFolders } from "../setup/folders.ts";
import { oneDriveFacts } from "../setup/inbox.ts";
import { isIsoDate, todayIso } from "./dates.ts";
import { PARTIAL_FILE_GRACE_MS } from "./exchange.ts";
import {
  MAX_PTO_FILE_BYTES,
  decide,
  findDuplicate,
  readPtoFile,
  recordFor,
  requestFromDraft,
  trimRecords,
  type PtoMailRecord,
  type PtoMessage,
  type PtoReading,
} from "./ptoMail.ts";
import { TIME_OFF_TYPES } from "./types.ts";
import { applyChanges, readStaff, staffDir, StaffError } from "./server.ts";

type Env = Record<string, string | undefined>;

/** Files handled per scan: the model is slow, so a flood is worked off over several scans. */
const MAX_PER_SCAN = 8;
export const PTO_REJECTED_DIR = "rejected";

export type PtoSource = "env" | "onedrive" | "local";

const isDirectory = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** AI_OS_PTO_INBOX_DIR, else `PTO-Inbox` in the AI-OS folder of the first OneDrive
 *  folder, else a folder inside the app's own data. */
export function resolvePtoInbox(env: Env = process.env): {
  dir: string;
  source: PtoSource;
} {
  const explicit = env.AI_OS_PTO_INBOX_DIR?.trim();
  if (explicit) return { dir: path.resolve(explicit), source: "env" };
  const [root] = oneDriveFacts(env, isDirectory).roots;
  if (root) return { dir: aiOsFolders(root).ptoInbox, source: "onedrive" };
  return { dir: path.join(staffDir(env), "pto-inbox"), source: "local" };
}

const recordsFile = (env: Env) => path.join(staffDir(env), "pto-mail.json");

export async function readPtoRecords(env: Env = process.env): Promise<PtoMailRecord[]> {
  const read = await readJsonSafe(recordsFile(env));
  if (read.kind === "missing") return [];
  const items =
    read.kind === "ok" ? (read.value as { items?: unknown })?.items : undefined;
  // A damaged log is reported, never replaced by an empty one that the next scan would write over it.
  if (!Array.isArray(items))
    throw new StaffError("The saved PTO email log could not be read.", 500);
  return items as PtoMailRecord[];
}

async function writeRecords(records: PtoMailRecord[], env: Env): Promise<void> {
  await writeJsonAtomic(recordsFile(env), { version: 1, items: trimRecords(records) });
}

const withLock = <T>(env: Env, run: () => Promise<T>): Promise<T> =>
  mutexFor(`${staffDir(env)}#pto`).run(run);

export interface PtoSyncSummary {
  folder: string;
  source: PtoSource;
  applied: number;
  needsReview: number;
  ignored: number;
  /** Files left for the next scan (more than one scan's worth, or the AI is not available). */
  waiting: number;
  /** Why the scan stopped early: the local AI is not available. */
  paused: string | null;
}

/** Reads one email and returns the AI's answer; throws what the runtime throws. */
export type PtoClassifier = (message: PtoMessage, today: string) => Promise<PtoReading>;

async function listJson(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((n) => n.toLowerCase().endsWith(".json")).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function reject(
  dir: string,
  name: string,
  reason: string,
  now: number,
): Promise<void> {
  await mkdir(path.join(dir, PTO_REJECTED_DIR), { recursive: true });
  const target = `${now}-${name}`;
  await rename(path.join(dir, name), path.join(dir, PTO_REJECTED_DIR, target));
  await writeFile(
    path.join(dir, PTO_REJECTED_DIR, `${target}.reason.txt`),
    `${reason}\r\n`,
    "utf8",
  );
}

const stoppedBecauseUnavailable = (error: unknown): string | null => {
  const e = error as { name?: string; code?: string; message?: string };
  if (
    e?.name === "AiRuntimeError" &&
    (e.code === "runtime-down" || e.code === "model-missing")
  ) {
    return e.message ?? "The local AI is not available.";
  }
  return null;
};

async function scan(
  env: Env,
  classify: PtoClassifier,
  now: () => number,
): Promise<PtoSyncSummary> {
  const { dir, source } = resolvePtoInbox(env);
  const summary: PtoSyncSummary = {
    folder: dir,
    source,
    applied: 0,
    needsReview: 0,
    ignored: 0,
    waiting: 0,
    paused: null,
  };
  await mkdir(dir, { recursive: true });
  const names = await listJson(dir);
  let handled = 0;

  for (const name of names) {
    if (handled >= MAX_PER_SCAN || summary.paused) {
      summary.waiting++;
      continue;
    }
    const file = path.join(dir, name);
    let info;
    try {
      info = await stat(file);
    } catch {
      continue;
    }
    if (!info.isFile()) continue;
    if (info.size > MAX_PTO_FILE_BYTES) {
      await reject(dir, name, "The file is larger than 1 MB.", now());
      continue;
    }
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue; // still being written or synced
    }
    const read = readPtoFile(text);
    if (!read.ok) {
      // A half-synced file looks like broken JSON; give it time before giving up.
      if (now() - info.mtimeMs < PARTIAL_FILE_GRACE_MS) continue;
      await reject(dir, name, read.reason, now());
      continue;
    }
    const message = read.message;

    const known = (await readPtoRecords(env)).some((r) => r.id === message.sourceId);
    if (known) {
      await rm(file, { force: true }); // the same email again (the flow can fire twice)
      continue;
    }

    handled++;
    const today = todayIso(new Date(now()));
    const stamp = new Date(now()).toISOString();
    let record: PtoMailRecord;
    try {
      const reading = await classify(message, today);
      const employees = await readStaff("employees", env);
      const existing = await readStaff("timeoff", env);
      const decision = decide({ message, reading, employees, existing, today });
      if (decision.action === "apply") {
        const request = requestFromDraft(decision.draft, message, decision.reason, stamp);
        await applyChanges("timeoff", { upsert: [request] }, env);
        record = recordFor(
          message,
          "applied",
          decision.reason || "Filed as approved Time off.",
          stamp,
          {
            draft: decision.draft,
            requestId: request.id,
          },
        );
        summary.applied++;
      } else if (decision.action === "review") {
        record = recordFor(message, "needs-review", decision.reason, stamp, {
          draft: decision.draft,
        });
        summary.needsReview++;
      } else {
        record = recordFor(message, "ignored", decision.reason, stamp);
        summary.ignored++;
      }
    } catch (error) {
      const unavailable = stoppedBecauseUnavailable(error);
      if (unavailable) {
        summary.paused = unavailable;
        summary.waiting++;
        handled--;
        continue; // keep the file; the next scan tries again
      }
      const reason =
        error instanceof StaffError
          ? error.message
          : `The AI could not read the email (${error instanceof Error ? error.message : "unknown error"}).`;
      record = recordFor(message, "needs-review", reason, stamp);
      summary.needsReview++;
    }
    await withLock(env, async () => {
      await writeRecords([...(await readPtoRecords(env)), record], env);
    });
    await rm(file, { force: true });
  }
  return summary;
}

declare global {
  var aiOsPtoSync: Promise<PtoSyncSummary> | undefined;
}

/** One scan; concurrent callers share the scan in progress. */
export function syncPtoMail(
  classify: PtoClassifier,
  env: Env = process.env,
  now: () => number = Date.now,
): Promise<PtoSyncSummary> {
  const running = globalThis.aiOsPtoSync;
  if (running) return running;
  const next = scan(env, classify, now).finally(() => {
    globalThis.aiOsPtoSync = undefined;
  });
  globalThis.aiOsPtoSync = next;
  return next;
}

export const ptoSyncRunning = (): boolean => globalThis.aiOsPtoSync !== undefined;

export interface PtoMailState {
  folder: string;
  source: PtoSource;
  running: boolean;
  /** Email files in the folder that have not been read yet. */
  waiting: number;
  /** Newest first, at most `limit`. */
  records: PtoMailRecord[];
  needsReview: number;
  /** When the newest email was received, or null. */
  lastReceivedAt: string | null;
}

export async function ptoMailState(
  env: Env = process.env,
  limit = 100,
): Promise<PtoMailState> {
  const { dir, source } = resolvePtoInbox(env);
  const records = await readPtoRecords(env);
  const sorted = [...records].sort((a, b) => b.processedAt.localeCompare(a.processedAt));
  return {
    folder: dir,
    source,
    running: ptoSyncRunning(),
    waiting: (await listJson(dir)).length,
    records: sorted.slice(0, limit),
    needsReview: records.filter((r) => r.status === "needs-review").length,
    lastReceivedAt: records.reduce<string | null>(
      (latest, r) => (latest === null || r.receivedAt > latest ? r.receivedAt : latest),
      null,
    ),
  };
}

const resolveSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("apply"),
    id: z.string().min(1).max(400),
    employeeId: z.string().min(1).max(80),
    type: z.enum(TIME_OFF_TYPES),
    startDate: z.string().refine(isIsoDate, "Choose a start date."),
    endDate: z.string().refine(isIsoDate, "Choose an end date."),
  }),
  z.object({ action: z.literal("dismiss"), id: z.string().min(1).max(400) }),
]);

/** A person's decision on an email that needed review: file the leave as they entered it, or dismiss. */
export async function resolvePtoMail(
  body: unknown,
  env: Env = process.env,
  now: () => string = () => new Date().toISOString(),
): Promise<PtoMailRecord> {
  const parsed = resolveSchema.safeParse(body);
  if (!parsed.success)
    throw new StaffError(parsed.error.issues[0]?.message ?? "Invalid request.");
  const input = parsed.data;
  return withLock(env, async () => {
    const records = await readPtoRecords(env);
    const record = records.find((r) => r.id === input.id);
    if (!record) throw new StaffError("That email is not in the list.", 404);
    if (record.status !== "needs-review")
      throw new StaffError("That email was already dealt with.");
    let updated: PtoMailRecord;
    if (input.action === "dismiss") {
      updated = {
        ...record,
        status: "dismissed",
        reason: "Dismissed.",
        processedAt: now(),
      };
    } else {
      if (input.endDate < input.startDate)
        throw new StaffError("The end date is before the start date.");
      const employees = await readStaff("employees", env);
      if (!employees.some((e) => e.id === input.employeeId))
        throw new StaffError("That person is not on the roster.", 404);
      const draft = {
        employeeId: input.employeeId,
        type: input.type,
        startDate: input.startDate,
        endDate: input.endDate,
      };
      if (findDuplicate(await readStaff("timeoff", env), draft)) {
        throw new StaffError("This person already has time off in these dates.");
      }
      const request = requestFromDraft(
        draft,
        { sourceId: record.id, subject: record.subject },
        "filed by hand after review",
        now(),
      );
      await applyChanges("timeoff", { upsert: [request] }, env);
      updated = {
        ...record,
        status: "applied",
        reason: "Filed by hand after review.",
        processedAt: now(),
        draft,
        requestId: request.id,
      };
    }
    await writeRecords(
      records.map((r) => (r.id === record.id ? updated : r)),
      env,
    );
    return updated;
  });
}
