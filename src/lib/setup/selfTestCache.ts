// The last self-test result, kept on disk so Setup does not re-run a pass that
// is still valid: it is reused while it passed, for this app version, and is
// younger than a week. Pure: the file system and the clock are injected.
import path from "node:path";
import type { SelfTestFacts } from "./report.ts";

export const SELFTEST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const SELFTEST_FILE = "selftest-result.json";

export interface StoredSelfTest {
  ok: boolean;
  at: string;
  appVersion: string;
  facts: SelfTestFacts;
}

export interface SelfTestIo {
  read(file: string): string | null;
  write(file: string, text: string): void;
}

export const selfTestFile = (dataDir: string): string =>
  path.join(dataDir, SELFTEST_FILE);

const isFacts = (value: unknown): value is SelfTestFacts => {
  const v = value as SelfTestFacts | null;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.ok === "boolean" &&
    typeof v.python === "string" &&
    Array.isArray(v.checks)
  );
};

/** The saved facts when they may stand in for a fresh run, else null. */
export function reusableSelfTest(
  stored: unknown,
  options: { now: number; appVersion: string },
): SelfTestFacts | null {
  const s = stored as Partial<StoredSelfTest> | null;
  if (!s || typeof s !== "object" || s.ok !== true || !isFacts(s.facts) || !s.facts.ok) {
    return null;
  }
  if (s.appVersion !== options.appVersion || typeof s.at !== "string") return null;
  const age = options.now - Date.parse(s.at);
  return Number.isFinite(age) && age >= 0 && age < SELFTEST_MAX_AGE_MS ? s.facts : null;
}

export function loadReusableSelfTest(
  file: string,
  io: SelfTestIo,
  options: { now: number; appVersion: string },
): SelfTestFacts | null {
  try {
    const text = io.read(file);
    return text === null ? null : reusableSelfTest(JSON.parse(text), options);
  } catch {
    return null;
  }
}

/** Best effort: failing to remember must never break the self-test itself. */
export function saveSelfTest(
  file: string,
  facts: SelfTestFacts,
  io: SelfTestIo,
  options: { now: number; appVersion: string },
): void {
  const stored: StoredSelfTest = {
    ok: facts.ok,
    at: new Date(options.now).toISOString(),
    appVersion: options.appVersion,
    facts,
  };
  try {
    io.write(file, `${JSON.stringify(stored)}\n`);
  } catch {
    // ignore
  }
}
