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
  planRequests,
  requestFileName,
  type OpenRequest,
} from "./exchange.ts";
import { isAwaitingProfile } from "./employees.ts";
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

async function writeRequest(
  dir: string,
  email: string,
  now: number,
  attempt = 1,
): Promise<boolean> {
  const name = requestFileName(email, now.toString(36));
  if (!name) return false;
  await writeFile(
    path.join(dir, REQUESTS_DIR, name),
    JSON.stringify({
      email: email.trim(),
      requestedAt: new Date(now).toISOString(),
      attempt,
    }),
    "utf8",
  );
  return true;
}

/** The requests in the folder: whose, which try, and how long ago. Unreadable files count
 *  as the first try, as old as the file. */
async function readOpenRequests(dir: string, now: number): Promise<OpenRequest[]> {
  const open: OpenRequest[] = [];
  for (const name of await listJson(path.join(dir, REQUESTS_DIR))) {
    const email = emailFromRequestFile(name);
    if (!email) continue;
    const file = path.join(dir, REQUESTS_DIR, name);
    let attempt = 1;
    let at = Number.NaN;
    try {
      const body = JSON.parse(await readFile(file, "utf8")) as {
        attempt?: unknown;
        requestedAt?: unknown;
      };
      if (typeof body.attempt === "number" && body.attempt >= 1) attempt = body.attempt;
      if (typeof body.requestedAt === "string") at = Date.parse(body.requestedAt);
    } catch {
      // keep the defaults
    }
    if (Number.isNaN(at)) {
      try {
        at = (await stat(file)).mtimeMs;
      } catch {
        continue; // gone since the listing
      }
    }
    open.push({ email, attempt, ageMs: Math.max(0, now - at) });
  }
  return open;
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

  const waiting = (await readStaff("employees", env)).filter((e) => isAwaitingProfile(e));
  if (waiting.length > 0) {
    const plan = planRequests({
      waiting: waiting.map((e) => e.deloitteEmail),
      open: await readOpenRequests(dir, now()),
    });
    for (const request of plan) {
      await removeRequestsFor(dir, request.email);
      if (await writeRequest(dir, request.email, now(), request.attempt)) {
        summary.requested++;
      }
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

/** Deletes every file the hand-over folder holds for these people: their requests,
 *  a profile that has not been applied, and anything set aside as rejected. Used when
 *  someone is deleted for good. A folder that does not exist yet is fine. */
export async function purgeExchangeFor(
  emails: readonly string[],
  env: Env = process.env,
): Promise<number> {
  const wanted = emails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!wanted.length) return 0;
  const { dir } = resolveExchange(env);
  let removed = 0;
  for (const sub of [REQUESTS_DIR, PROFILES_DIR, REJECTED_DIR]) {
    let names: string[];
    try {
      names = await readdir(path.join(dir, sub));
    } catch {
      continue;
    }
    for (const name of names) {
      const lower = name.toLowerCase();
      const owner =
        sub === REQUESTS_DIR
          ? (emailFromRequestFile(name)?.toLowerCase() ?? "")
          : lower
              .replace(/\.reason\.txt$/, "")
              .replace(/\.json$/, "")
              .replace(/^\d+-/, "");
      if (!wanted.includes(owner)) continue;
      await rm(path.join(dir, sub, name), { force: true });
      removed++;
    }
  }
  return removed;
}

/** Clears the open requests of everyone still waiting, so their tries start over; the
 *  scan that follows sends them again a few at a time. Returns how many are waiting. */
export async function resendAllRequests(env: Env = process.env): Promise<number> {
  const waiting = (await readStaff("employees", env)).filter((e) => isAwaitingProfile(e));
  const { dir } = resolveExchange(env);
  await ensureDirs(dir);
  for (const person of waiting) await removeRequestsFor(dir, person.deloitteEmail);
  return waiting.length;
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
