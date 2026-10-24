// Small file helpers for the PMO store: atomic JSON writes (temp file, then
// rename), tolerant reads, JSONL appends, and a promise-chain mutex. Server
// only. Nothing here knows about the PMO data model.
import { randomBytes } from "node:crypto";
import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    await writeFile(temp, JSON.stringify(value, null, 2), "utf8");
    await renameWithRetry(temp, file);
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
    await writeFile(temp, text, "utf8");
    await renameWithRetry(temp, file);
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
