// The PTO email hand-over, server side. A Power Automate flow (docs/pto-email-flow.md)
// writes one file per email into the PTO-Inbox folder in OneDrive; a scan reads each
// one, asks the local AI what it says (PTO, comp off, sick leave ...), files the leave
// as a pending Time off request for the sender (a person approves or rejects it in the
// Time off list) and records what was done. An email that cannot become a request is
// moved to `rejected` with the reason beside it. OneDrive carries the files; mail that
// arrives while the app is closed is handled at the next scan.
import { statSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { mutexFor, readJsonSafe, writeJsonAtomic } from "../pmo/server/fsx.ts";
import { aiOsFolders } from "../setup/folders.ts";
import { oneDriveFacts } from "../setup/inbox.ts";
import { todayIso } from "./dates.ts";
import { PARTIAL_FILE_GRACE_MS } from "./exchange.ts";
import {
  MAX_PTO_FILE_BYTES,
  decide,
  readPtoFile,
  recordFor,
  requestFromDraft,
  trimRecords,
  type PtoMailRecord,
  type PtoMessage,
  type PtoReading,
} from "./ptoMail.ts";
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
  /** Pending requests filed. */
  filed: number;
  /** Emails that could not become a request and were moved to `rejected`. */
  setAside: number;
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
    filed: 0,
    setAside: 0,
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
      if (decision.action === "file") {
        const note = decision.check
          ? `Check this one: ${decision.reason}`
          : decision.reason;
        const request = requestFromDraft(decision.draft, message, note, stamp);
        await applyChanges("timeoff", { upsert: [request] }, env);
        record = recordFor(
          message,
          "filed",
          decision.reason || "Filed as a pending Time off request.",
          stamp,
          { requestId: request.id },
        );
        summary.filed++;
      } else if (decision.action === "set-aside") {
        await reject(dir, name, decision.reason, now());
        record = recordFor(message, "set-aside", decision.reason, stamp);
        summary.setAside++;
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
      await reject(dir, name, reason, now());
      record = recordFor(message, "set-aside", reason, stamp);
      summary.setAside++;
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
  /** Emails that could not become a request (their files are in `rejected`). */
  setAside: number;
  /** When the newest email was received, or null. */
  lastReceivedAt: string | null;
}

export async function ptoMailState(env: Env = process.env): Promise<PtoMailState> {
  const { dir, source } = resolvePtoInbox(env);
  const records = await readPtoRecords(env);
  return {
    folder: dir,
    source,
    running: ptoSyncRunning(),
    waiting: (await listJson(dir)).length,
    setAside: records.filter((r) => r.status === "set-aside").length,
    lastReceivedAt: records.reduce<string | null>(
      (latest, r) => (latest === null || r.receivedAt > latest ? r.receivedAt : latest),
      null,
    ),
  };
}
