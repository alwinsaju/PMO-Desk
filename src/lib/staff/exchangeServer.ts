// The folder hand-over with the M365 profile flow, server side. The app writes
// a small request file for each person waiting for a profile; a Power Automate
// cloud flow (see docs/staff-m365-flow.md) looks the person up in M365 and writes
// a profile file back; the next scan applies it and tidies both files away.
// OneDrive sync carries the files between the cloud and this computer, and a
// profile that arrives while the app is closed is applied at the next scan.
import { statSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { oneDriveFacts } from "../setup/inbox.ts";
import { pickStaffExchange, STAFF_EXCHANGE_FOLDER_NAME } from "../setup/folders.ts";
import {
  MAX_PROFILE_FILE_BYTES,
  PARTIAL_FILE_GRACE_MS,
  PROFILES_DIR,
  REJECTED_DIR,
  REQUESTS_DIR,
  emailFromRequestFile,
  parseProfileFile,
  requestFileName,
} from "./exchange.ts";
import { applyProfileSync, readStaff, staffDir, StaffError } from "./server.ts";

type Env = Record<string, string | undefined>;

export const EXCHANGE_FOLDER_NAME = STAFF_EXCHANGE_FOLDER_NAME;
/** Files handled per scan, so a flood cannot hold the server up. */
const MAX_PER_SCAN = 100;

export type ExchangeSource = "env" | "onedrive" | "local";

const isDirectory = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** AI_OS_STAFF_EXCHANGE_DIR, else `Staff-Exchange` in the AI-OS folder of the first
 *  OneDrive folder (work account first; an older `Staff-Exchange` directly in
 *  OneDrive is kept when that is where it is), else a folder inside the app's data. */
export function resolveExchange(env: Env = process.env): {
  dir: string;
  source: ExchangeSource;
} {
  const explicit = env.AI_OS_STAFF_EXCHANGE_DIR?.trim();
  if (explicit) return { dir: path.resolve(explicit), source: "env" };
  const [root] = oneDriveFacts(env, isDirectory).roots;
  if (root) return { dir: pickStaffExchange(root, isDirectory), source: "onedrive" };
  return { dir: path.join(staffDir(env), "exchange"), source: "local" };
}

export interface SyncSummary {
  folder: string;
  source: ExchangeSource;
  applied: number;
  rejected: number;
  requested: number;
}

async function ensureDirs(dir: string): Promise<void> {
  await Promise.all(
    [REQUESTS_DIR, PROFILES_DIR, REJECTED_DIR].map((name) =>
      mkdir(path.join(dir, name), { recursive: true }),
    ),
  );
}

async function listJson(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((n) => n.toLowerCase().endsWith(".json"));
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
  const target = `${now}-${name}`;
  await rename(path.join(dir, PROFILES_DIR, name), path.join(dir, REJECTED_DIR, target));
  await writeFile(
    path.join(dir, REJECTED_DIR, `${target}.reason.txt`),
    `${reason}\r\n`,
    "utf8",
  );
}

async function removeRequestsFor(dir: string, email: string): Promise<void> {
  const wanted = email.toLowerCase();
  for (const name of await listJson(path.join(dir, REQUESTS_DIR))) {
    if (emailFromRequestFile(name)?.toLowerCase() === wanted) {
      await rm(path.join(dir, REQUESTS_DIR, name), { force: true });
    }
  }
}

async function writeRequest(dir: string, email: string, now: number): Promise<boolean> {
  const name = requestFileName(email, now.toString(36));
  if (!name) return false;
  await writeFile(
    path.join(dir, REQUESTS_DIR, name),
    JSON.stringify({ email: email.trim(), requestedAt: new Date(now).toISOString() }),
    "utf8",
  );
  return true;
}

async function scan(env: Env, now: () => number): Promise<SyncSummary> {
  const { dir, source } = resolveExchange(env);
  const summary: SyncSummary = {
    folder: dir,
    source,
    applied: 0,
    rejected: 0,
    requested: 0,
  };
  await ensureDirs(dir);

  for (const name of (await listJson(path.join(dir, PROFILES_DIR))).slice(
    0,
    MAX_PER_SCAN,
  )) {
    const file = path.join(dir, PROFILES_DIR, name);
    let info;
    try {
      info = await stat(file);
    } catch {
      continue; // gone since the listing
    }
    if (!info.isFile()) continue;
    if (info.size > MAX_PROFILE_FILE_BYTES) {
      await reject(dir, name, "The file is larger than 3 MB.", now());
      summary.rejected++;
      continue;
    }
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue; // still being written or synced
    }
    const parsed = parseProfileFile(text);
    if (!parsed.ok) {
      // A half-synced file looks like broken JSON; give it time before giving up.
      if (now() - info.mtimeMs < PARTIAL_FILE_GRACE_MS) continue;
      await reject(dir, name, parsed.reason, now());
      summary.rejected++;
      continue;
    }
    try {
      await applyProfileSync(parsed.profile, env);
      await rm(file, { force: true });
      await removeRequestsFor(dir, parsed.profile.email);
      summary.applied++;
    } catch (error) {
      if (!(error instanceof StaffError) || error.status === 500) {
        console.error("[staff] could not apply a profile file:", error);
        continue; // leave it for the next scan
      }
      await reject(dir, name, error.message, now());
      summary.rejected++;
    }
  }

  const waiting = (await readStaff("employees", env)).filter(
    (e) => e.profileSync === "pending",
  );
  if (waiting.length > 0) {
    const asked = new Set(
      (await listJson(path.join(dir, REQUESTS_DIR)))
        .map(emailFromRequestFile)
        .filter((e): e is string => e !== null)
        .map((e) => e.toLowerCase()),
    );
    for (const person of waiting) {
      if (asked.has(person.deloitteEmail.toLowerCase())) continue;
      if (await writeRequest(dir, person.deloitteEmail, now())) summary.requested++;
    }
  }
  return summary;
}

declare global {
  var aiOsStaffSync: Promise<SyncSummary> | undefined;
}

/** One scan: applies profile files that arrived and asks for the ones still
 *  missing. Concurrent callers (several windows) share the scan in progress. */
export function syncExchange(
  env: Env = process.env,
  now: () => number = Date.now,
): Promise<SyncSummary> {
  const running = globalThis.aiOsStaffSync;
  if (running) return running;
  const next = scan(env, now).finally(() => {
    globalThis.aiOsStaffSync = undefined;
  });
  globalThis.aiOsStaffSync = next;
  return next;
}

/** Writes a fresh request for one waiting person (a new file, so the flow runs again). */
export async function resendRequest(
  employeeId: string,
  env: Env = process.env,
  now: () => number = Date.now,
): Promise<void> {
  const person = (await readStaff("employees", env)).find((e) => e.id === employeeId);
  if (!person) throw new StaffError("Unknown employee.", 404);
  const { dir } = resolveExchange(env);
  await ensureDirs(dir);
  await removeRequestsFor(dir, person.deloitteEmail);
  if (!(await writeRequest(dir, person.deloitteEmail, now()))) {
    throw new StaffError("That email address cannot be used for a profile request.");
  }
}
