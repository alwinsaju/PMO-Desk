// Where the PMO inbox folder is, whether it exists, and whether OneDrive (which
// syncs it) is signed in on this computer. Pure: the environment and the
// filesystem checks are passed in.

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

/** Folders worth offering: PMO-Inbox inside each OneDrive root, that exists first. */
export function inboxSuggestions(
  oneDrive: OneDriveFacts,
  current: string,
  isDirectory: (path: string) => boolean,
): string[] {
  const candidates = oneDrive.roots.map(
    (root) => `${root.replace(/[\\/]+$/, "")}\\${INBOX_FOLDER_NAME}`,
  );
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
}

export type SaveInboxResult = { ok: true } | { ok: false; reason: string };

/** Saves the chosen folder as the PMO inbox. Refused when the environment
 *  already fixes it (AI_OS_PMO_INBOX_DIR wins over the saved setting anyway). */
export async function saveInboxChoice(options: {
  raw: unknown;
  env: Env;
  store: InboxConfigStore;
  isDirectory: (path: string) => boolean;
  isAbsolute: (path: string) => boolean;
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
  const config = await options.store.loadConfig();
  await options.store.saveConfig({ ...config, inboxDir: chosen.path });
  return { ok: true };
}
