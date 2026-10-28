// Has this installation ever made an AI call? Ollama is started at launch only
// when it has: someone who never uses AI should not pay for an idle server. The
// flag is a tiny JSON file next to the saved model choice. Imports nothing
// extensionless (plain Node runs the tests).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { modelChoicePath } from "./modelChoice.ts";

type Env = Record<string, string | undefined>;

export function aiUsedPath(env: Env = process.env): string {
  return path.join(path.dirname(modelChoicePath(env)), "ai-used.json");
}

export function hasUsedAi(env: Env = process.env): boolean {
  try {
    const parsed = JSON.parse(readFileSync(aiUsedPath(env), "utf8")) as {
      used?: unknown;
    } | null;
    return parsed?.used === true;
  } catch {
    return false;
  }
}

const recorded = new Set<string>();

/** Remembers that AI was used. Best effort and written once per file per process. */
export function markAiUsed(env: Env = process.env, now: () => number = Date.now): void {
  const file = aiUsedPath(env);
  if (recorded.has(file)) return;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(
      tmp,
      `${JSON.stringify({ used: true, at: new Date(now()).toISOString() })}\n`,
    );
    renameSync(tmp, file);
    recorded.add(file);
  } catch {
    // Not remembering only costs a lazy start next launch.
  }
}

/** Test hook: forget what this process already wrote. */
export function resetAiUsedMemo(): void {
  recorded.clear();
}
