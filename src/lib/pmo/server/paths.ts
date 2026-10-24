// Where the PMO app keeps its data and where it looks for new messages.
// Both can be redirected with env vars, which is how every test and preview
// run points at a throwaway directory instead of real data.
import os from "node:os";
import path from "node:path";

type Env = Record<string, string | undefined>;

/** AI_OS_PMO_DATA_DIR (desktop/main.cjs sets it to userData\pmo), else
 *  %LOCALAPPDATA%\AI OS\pmo, outside the repo and OneDrive. */
export function resolveDataDir(env: Env = process.env): string {
  const explicit = env.AI_OS_PMO_DATA_DIR?.trim();
  if (explicit) return path.resolve(explicit);
  const local = env.LOCALAPPDATA?.trim() || path.join(os.homedir(), "AppData", "Local");
  return path.join(local, "AI OS", "pmo");
}

/** AI_OS_PMO_INBOX_DIR wins over config.inboxDir. */
export function resolveInboxDir(configured: string, env: Env = process.env): string {
  const override = env.AI_OS_PMO_INBOX_DIR?.trim();
  return path.resolve(override || configured);
}

export interface PmoPaths {
  root: string;
  config: string;
  raw: string;
  quarantine: string;
  rejectedFiles: string;
  queue: string;
  todos: string;
  seen: string;
  /** Which reminders were delivered, and who has claimed one (server/notify.ts). */
  notify: string;
  ingestLog: string;
  aiCallsLog: string;
  audit: string;
}

export function pmoPaths(root: string): PmoPaths {
  return {
    root,
    config: path.join(root, "config.json"),
    raw: path.join(root, "raw"),
    quarantine: path.join(root, "quarantine"),
    rejectedFiles: path.join(root, "rejected-files"),
    queue: path.join(root, "queue"),
    todos: path.join(root, "todos"),
    seen: path.join(root, "state", "seen.json"),
    notify: path.join(root, "state", "notify.json"),
    ingestLog: path.join(root, "logs", "ingest.jsonl"),
    aiCallsLog: path.join(root, "logs", "ai-calls.jsonl"),
    audit: path.join(root, "audit.jsonl"),
  };
}

/** Record ids come from our own generators, but they also arrive in URLs, so
 *  anything that isn't plain `prefix_hex` is refused before touching a path. */
export function isSafeId(id: string): boolean {
  return /^[a-z]{1,4}_[0-9a-f]{8,40}$/.test(id);
}

/** Where the Electron shell reads the few settings it needs before (or
 *  without) the UI: `AI_OS_DESKTOP_PREFS_FILE`, set by desktop/main.cjs to
 *  `<userData>\desktop-prefs.json`. null when not running under the shell. */
export function resolveDesktopPrefsFile(env: Env = process.env): string | null {
  const explicit = env.AI_OS_DESKTOP_PREFS_FILE?.trim();
  return explicit ? path.resolve(explicit) : null;
}
