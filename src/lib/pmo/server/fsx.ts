// Small file helpers for the PMO store: atomic JSON writes (temp file, then
// rename), tolerant reads, JSONL appends, and a promise-chain mutex. Server
// only. Nothing here knows about the PMO data model.
import { randomBytes } from "node:crypto";
import {
  appendFile,
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Counts successful fsyncs of a temp file (read by tests). */
export const durability = { fsyncs: 0 };

/** Write and fsync, so the rename that follows can never publish a file whose
 *  bytes are still only in the page cache (a power cut then leaves it empty). */
async function writeDurable(file: string, text: string): Promise<void> {
  const handle = await open(file, "w");
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
    durability.fsyncs++;
  } finally {
    await handle.close();
  }
}

/** Best effort: Windows cannot open a directory for sync, and that is fine. */
async function syncDirectory(dir: string): Promise<void> {
  try {
    const handle = await open(dir, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // not supported here
  }
}

/** rename() over an existing file can briefly fail on Windows (EPERM/EBUSY)
 *  while an indexer or antivirus holds it; a short retry clears that. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 8 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) {
        throw error;
      }
      await delay(25 * (attempt + 1));
    }
  }
}

const pendingWrites = new Map<string, Promise<void>>();

async function writeJsonOnce(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeDurable(temp, JSON.stringify(value, null, 2));
    await renameWithRetry(temp, file);
    await syncDirectory(path.dirname(file));
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

/** Write JSON so a reader (or a crash) never sees a half-written file. Writes
 *  to the same path are queued, because two renames onto one target at once
 *  can fail on Windows. */
export function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const key = path.resolve(file).toLowerCase();
  const previous = pendingWrites.get(key) ?? Promise.resolve();
  const next = previous.then(() => writeJsonOnce(file, value));
  const tail = next.then(
    () => undefined,
    () => undefined,
  );
  pendingWrites.set(key, tail);
  void tail.then(() => {
    if (pendingWrites.get(key) === tail) pendingWrites.delete(key);
  });
  return next;
}

/** Replace a text file in one step (temp file, then rename). Used to rewrite a
 *  log without a reader or a crash ever seeing half of it. */
export async function writeTextAtomic(file: string, text: string): Promise<void> {
  const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeDurable(temp, text);
    await renameWithRetry(temp, file);
    await syncDirectory(path.dirname(file));
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

/** null when the file doesn't exist; throws on unreadable/corrupt JSON. */
export async function readJson<T = unknown>(file: string): Promise<T | null> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return JSON.parse(text.replace(/^﻿/, "")) as T;
}

/** Like readJson, but a file that is there and cannot be parsed (empty,
 *  truncated, garbage) is reported as `corrupt` rather than thrown; only real
 *  I/O errors (EBUSY, EACCES, ...) throw, because those say nothing about the
 *  file's content. */
export async function readJsonSafe(
  file: string,
): Promise<
  | { kind: "ok"; value: unknown }
  | { kind: "missing" }
  | { kind: "corrupt"; reason: string }
> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    throw error;
  }
  try {
    return { kind: "ok", value: JSON.parse(text.replace(/^﻿/, "")) };
  } catch (error) {
    return {
      kind: "corrupt",
      reason: text.trim() === "" ? "empty file" : (error as Error).message,
    };
  }
}

/** File names (not paths) in a directory ending in `suffix`; [] if it's missing. */
export async function listFiles(dir: string, suffix = ".json"): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((name) => name.toLowerCase().endsWith(suffix));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function appendJsonl(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(value)}\n`, "utf8");
}

/** audit.jsonl -> audit.1.jsonl -> audit.2.jsonl ...; the oldest is dropped. */
export function rotatedName(file: string, n: number): string {
  const ext = path.extname(file);
  return `${file.slice(0, file.length - ext.length)}.${n}${ext}`;
}

/** Moves `file` to its `.1` name when it has reached `maxBytes`, shifting older
 *  ones up and keeping `keep` of them. Returns whether it rotated. */
export async function rotateIfLarge(
  file: string,
  maxBytes: number,
  keep: number,
): Promise<boolean> {
  const size = await stat(file).then(
    (s) => s.size,
    () => 0,
  );
  if (size < maxBytes) return false;
  await unlink(rotatedName(file, keep)).catch(() => undefined);
  for (let n = keep - 1; n >= 1; n--) {
    await rename(rotatedName(file, n), rotatedName(file, n + 1)).catch(() => undefined);
  }
  await rename(file, rotatedName(file, 1));
  return true;
}

export const AUDIT_MAX_BYTES = 5 * 1024 * 1024;
export const AUDIT_KEEP = 2;

const rotatingAppends = new Map<string, Promise<void>>();

/** appendJsonl that first rotates a large file. Appends to one file are
 *  chained so two callers cannot rotate it twice. */
export function appendJsonlRotating(
  file: string,
  value: unknown,
  maxBytes = AUDIT_MAX_BYTES,
  keep = AUDIT_KEEP,
): Promise<void> {
  const key = path.resolve(file).toLowerCase();
  const previous = rotatingAppends.get(key) ?? Promise.resolve();
  const next = previous.then(async () => {
    await rotateIfLarge(file, maxBytes, keep).catch(() => false);
    await appendJsonl(file, value);
  });
  const tail = next.then(
    () => undefined,
    () => undefined,
  );
  rotatingAppends.set(key, tail);
  void tail.then(() => {
    if (rotatingAppends.get(key) === tail) rotatingAppends.delete(key);
  });
  return next;
}

/** Move a file, falling back to copy + delete when rename can't cross drives
 *  (the OneDrive inbox and the app data dir may be on different volumes). */
export async function moveFile(from: string, to: string): Promise<void> {
  await mkdir(path.dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await copyFile(from, to);
    await unlink(from);
  }
}

/** Runs async functions one at a time, in call order. A rejection does not
 *  poison the chain. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

declare global {
  var aiOsPmoMutexes: Map<string, Mutex> | undefined;
}

/** One mutex per data directory for the whole process. Next compiles each
 *  route into its own module graph, so a module-level mutex would not be
 *  shared between them; globalThis is. */
export function mutexFor(dataDir: string): Mutex {
  const registry = (globalThis.aiOsPmoMutexes ??= new Map());
  const key = path.resolve(dataDir).toLowerCase();
  let mutex = registry.get(key);
  if (!mutex) {
    mutex = new Mutex();
    registry.set(key, mutex);
  }
  return mutex;
}
