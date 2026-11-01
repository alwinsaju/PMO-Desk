// Where the PMO inbox folder is, whether it exists, and whether OneDrive (which
// syncs it) is signed in on this computer. Pure: the environment and the
// filesystem checks are passed in.
import { looksLikeIntake } from "../pmo/intakeProbe.ts";
import { aiOsFolders, legacyFolders } from "./folders.ts";

export interface OneDriveFacts {
  /** A OneDrive account is signed in (Windows sets these variables then). */
  signedIn: boolean;
  /** The sync roots found, work account first. */
  roots: string[];
}

type Env = Record<string, string | undefined>;

const ONEDRIVE_VARS = ["OneDriveCommercial", "OneDrive", "OneDriveConsumer"];
export const INBOX_FOLDER_NAME = "PMO-Inbox";

function readEnv(env: Env, name: string): string | undefined {
  const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
  const value = key === undefined ? undefined : env[key]?.trim();
  return value || undefined;
}

export function oneDriveFacts(
  env: Env,
  isDirectory: (path: string) => boolean,
): OneDriveFacts {
  const roots: string[] = [];
  for (const name of ONEDRIVE_VARS) {
    const root = readEnv(env, name);
    if (
      root &&
      isDirectory(root) &&
      !roots.some((r) => r.toLowerCase() === root.toLowerCase())
    ) {
      roots.push(root);
    }
  }
  return { signedIn: roots.length > 0, roots };
}

/** Folders worth offering: PMO-Inbox inside the AI-OS folder of each OneDrive root (and
 *  a PMO-Inbox from before that layout, when it is there); folders that exist first. */
export function inboxSuggestions(
  oneDrive: OneDriveFacts,
  current: string,
  isDirectory: (path: string) => boolean,
): string[] {
  const candidates = oneDrive.roots.flatMap((root) => {
    const folder = aiOsFolders(root).pmoInbox;
    const legacy = legacyFolders(root).pmoInbox;
    return isDirectory(legacy) && !isDirectory(folder) ? [legacy, folder] : [folder];
  });
  const unique = candidates.filter(
    (path, index) =>
      path.toLowerCase() !== current.toLowerCase() &&
      candidates.findIndex((c) => c.toLowerCase() === path.toLowerCase()) === index,
  );
  return [...unique.filter(isDirectory), ...unique.filter((p) => !isDirectory(p))];
}

export type ValidatedInbox = { ok: true; path: string } | { ok: false; reason: string };

/** A folder the person picked: absolute, existing, a directory. */
export function validateInboxChoice(
  raw: unknown,
  isDirectory: (path: string) => boolean,
  isAbsolute: (path: string) => boolean,
): ValidatedInbox {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, reason: "Choose a folder first." };
  }
  const path = raw.trim().replace(/^"(.*)"$/, "$1");
  if (!isAbsolute(path)) {
    return {
      ok: false,
      reason:
        "Use the full path of the folder, for example C:\\Users\\you\\OneDrive\\PMO-Inbox.",
    };
  }
  if (!isDirectory(path)) {
    return {
      ok: false,
      reason:
        "That folder does not exist (or is not a folder). Create it first, or pick another one.",
    };
  }
  return { ok: true, path };
}

export interface InboxConfigStore {
  loadConfig(): Promise<{ inboxDir: string }>;
  saveConfig(config: { inboxDir: string }): Promise<void>;
  /** The PMO store's per-data-dir lock: load + save must not interleave with another config write. */
  withLock?<T>(fn: () => Promise<T>): Promise<T>;
}

export type SaveInboxResult =
  | { ok: true }
  /** `needsConfirmation`: only the "already holds other JSON" rule failed; the
   *  same request with `confirmNonEmpty: true` is accepted. */
  | { ok: false; reason: string; needsConfirmation?: true };

/** What the folder check needs from the computer; injected so tests never touch
 *  a real user folder. */
export interface InboxSafetyFacts {
  /** The user's home folder. */
  home: string;
  /** Folders that hold PMO Desk itself or its data; the folder and everything in it is refused. */
  protectedDirs?: string[];
  /** Other roots (OneDrive) whose Documents, Desktop and Downloads are refused too. */
  libraryRoots?: string[];
  /** The start of the text of up to `limit` `.json` files directly in `dir`. */
  sampleJsonFiles: (dir: string, limit: number) => { name: string; text: string }[];
}

/** How many files in a folder are looked at for other JSON. */
export const INBOX_SAMPLE_LIMIT = 40;
const LIBRARY_FOLDERS = ["Documents", "Desktop", "Downloads"];
const FIX =
  "Choose a dedicated folder for PMO messages, for example a new one named PMO-Inbox.";

/** Case, slash direction and trailing separators ignored. */
function comparable(value: string): string {
  const unc = /^[\\/]{2}(?![\\/])/.test(value.trim());
  const flat = value
    .trim()
    .replace(/[\\/]+/g, "\\")
    .replace(/\\+$/, "")
    .toLowerCase();
  return unc ? `\\${flat}` : flat;
}

/** Why the folder cannot be the inbox, or null when it can. The ingest parks
 *  files that look like failed messages, so a folder that holds other things
 *  must be a deliberate choice. */
export function inboxFolderProblem(
  chosen: string,
  facts: InboxSafetyFacts,
  confirmNonEmpty: boolean,
): { reason: string; needsConfirmation?: true } | null {
  const folder = comparable(chosen);
  if (
    folder === "" ||
    /^[a-z]:$/.test(folder) ||
    /^\\\\[^\\]+(\\[^\\]+)?$/.test(folder)
  ) {
    return { reason: `That is a whole drive or network share. ${FIX}` };
  }
  if (folder === comparable(facts.home)) {
    return { reason: `That is your user folder. ${FIX}` };
  }
  for (const root of [facts.home, ...(facts.libraryRoots ?? [])]) {
    const hit = LIBRARY_FOLDERS.find((name) => folder === comparable(`${root}\\${name}`));
    if (hit)
      return { reason: `That is your ${hit} folder, which holds your own files. ${FIX}` };
  }
  for (const dir of facts.protectedDirs ?? []) {
    const protectedDir = comparable(dir);
    if (
      protectedDir &&
      (folder === protectedDir || folder.startsWith(`${protectedDir}\\`))
    ) {
      return {
        reason: `That folder belongs to PMO Desk itself (its program or data files). ${FIX}`,
      };
    }
  }
  if (confirmNonEmpty) return null;
  const files = facts.sampleJsonFiles(chosen, INBOX_SAMPLE_LIMIT);
  const other = files.filter((file) => !looksLikeIntake(file.text));
  if (other.length > 0) {
    const names = other
      .slice(0, 3)
      .map((file) => file.name)
      .join(", ");
    return {
      reason: `That folder already holds ${other.length} JSON file${
        other.length === 1 ? "" : "s"
      } that ${other.length === 1 ? "is" : "are"} not PMO messages (${names}). PMO Desk leaves them alone, but they would show up as clutter. ${FIX} Or confirm that you want to use it anyway.`,
      needsConfirmation: true,
    };
  }
  return null;
}

/** Saves the chosen folder as the PMO inbox. Refused when the environment
 *  already fixes it (AI_OS_PMO_INBOX_DIR wins over the saved setting anyway),
 *  and for a folder that is clearly not a dedicated inbox (see inboxFolderProblem). */
export async function saveInboxChoice(options: {
  raw: unknown;
  env: Env;
  store: InboxConfigStore;
  isDirectory: (path: string) => boolean;
  isAbsolute: (path: string) => boolean;
  safety: InboxSafetyFacts;
  /** The person confirmed a folder that already holds other JSON files. */
  confirmNonEmpty?: boolean;
}): Promise<SaveInboxResult> {
  if (readEnv(options.env, "AI_OS_PMO_INBOX_DIR")) {
    return {
      ok: false,
      reason:
        "The inbox folder is set by the AI_OS_PMO_INBOX_DIR setting and cannot be changed here.",
    };
  }
  const chosen = validateInboxChoice(
    options.raw,
    options.isDirectory,
    options.isAbsolute,
  );
  if (!chosen.ok) return chosen;
  const problem = inboxFolderProblem(
    chosen.path,
    options.safety,
    options.confirmNonEmpty === true,
  );
  if (problem) return { ok: false, ...problem };
  const save = async (): Promise<SaveInboxResult> => {
    const config = await options.store.loadConfig();
    await options.store.saveConfig({ ...config, inboxDir: chosen.path });
    return { ok: true };
  };
  return options.store.withLock ? options.store.withLock(save) : save();
}
