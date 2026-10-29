// Server half of the first-time setup marker (see firstTime.ts).
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveDataDir } from "@/lib/pmo/server/paths";
import { writeTextAtomic } from "@/lib/pmo/server/fsx";
import {
  FIRST_TIME_FILE,
  doneMarker,
  firstTimePending,
  parseFirstTime,
} from "./firstTime";

type Env = Record<string, string | undefined>;

const markerFile = (env: Env) => path.join(resolveDataDir(env), FIRST_TIME_FILE);

/** AI_OS_FORCE_FIRST_TIME=1 opens the page on every launch (to try it without an install). */
const forced = (env: Env) => env.AI_OS_FORCE_FIRST_TIME?.trim() === "1";

export async function readFirstTimePending(env: Env = process.env): Promise<boolean> {
  let text: string | null = null;
  try {
    text = await readFile(markerFile(env), "utf8");
  } catch {
    // No marker: not a fresh install.
  }
  return firstTimePending(parseFirstTime(text), forced(env));
}

export async function completeFirstTime(env: Env = process.env): Promise<void> {
  await mkdir(resolveDataDir(env), { recursive: true });
  await writeTextAtomic(markerFile(env), doneMarker(new Date()));
}
