// The OneDrive folders PMO Desk shares with Power Automate, all inside one folder so
// they are easy to find and to map:
//
//   <OneDrive>\AI-OS\PMO-Inbox        flagged emails and Teams messages for the PMO To-Do
//   <OneDrive>\AI-OS\Staff-Exchange   the M365 profile hand-over (requests / profiles / rejected)
//   <OneDrive>\AI-OS\PTO-Inbox        PTO emails for the shift roster
//
// The installer creates them on a fresh install; the app also creates whatever is
// missing. Installs from before this layout used PMO-Inbox and Staff-Exchange
// directly in the OneDrive folder: those keep working (see the legacy helpers).
// RULE: every folder PMO Desk or a flow uses in OneDrive lives inside AI-OS. To add one:
// name it here, add it to aiOsFolders/describeFolders, to the installer
// (build/installer.nsh) and to the Setup checks, then give it a flow guide.
// Pure: the filesystem is passed in. No node: imports, because the setup report that
// uses these names is also read in the browser.

// Kept as "AI-OS" on purpose: live Power Automate flows write into this OneDrive folder, so renaming it
// would silently stop intake. It is a folder name, not product text.
export const AI_OS_FOLDER_NAME = "AI-OS";
export const PMO_INBOX_FOLDER_NAME = "PMO-Inbox";
export const STAFF_EXCHANGE_FOLDER_NAME = "Staff-Exchange";
export const PTO_INBOX_FOLDER_NAME = "PTO-Inbox";

/** The sub-folders of Staff-Exchange the profile flow and the app use. */
export const STAFF_EXCHANGE_SUBFOLDERS = ["requests", "profiles", "rejected"] as const;

export type AiOsFolderKey = "pmoInbox" | "staffExchange" | "ptoInbox";

export interface AiOsFolders {
  /** `<OneDrive>\AI-OS`. */
  root: string;
  pmoInbox: string;
  staffExchange: string;
  ptoInbox: string;
}

export interface AiOsFolderInfo {
  key: AiOsFolderKey;
  /** The folder's name in OneDrive. */
  name: string;
  path: string;
  /** What puts files there and what reads them, in one plain line. */
  purpose: string;
}

const clean = (root: string): string => root.replace(/[\\/]+$/, "");

/** Joins with the separator the root already uses (backslash on Windows). */
function join(root: string, ...parts: string[]): string {
  const sep = root.includes("/") && !root.includes("\\") ? "/" : "\\";
  return [clean(root), ...parts].join(sep);
}

/** The folders inside one OneDrive root. */
export function aiOsFolders(oneDriveRoot: string): AiOsFolders {
  const root = join(oneDriveRoot, AI_OS_FOLDER_NAME);
  return {
    root,
    pmoInbox: join(root, PMO_INBOX_FOLDER_NAME),
    staffExchange: join(root, STAFF_EXCHANGE_FOLDER_NAME),
    ptoInbox: join(root, PTO_INBOX_FOLDER_NAME),
  };
}

/** Where installs from before the AI-OS folder kept them (directly in OneDrive). */
export function legacyFolders(
  oneDriveRoot: string,
): Pick<AiOsFolders, "pmoInbox" | "staffExchange"> {
  return {
    pmoInbox: join(oneDriveRoot, PMO_INBOX_FOLDER_NAME),
    staffExchange: join(oneDriveRoot, STAFF_EXCHANGE_FOLDER_NAME),
  };
}

export function describeFolders(folders: AiOsFolders): AiOsFolderInfo[] {
  return [
    {
      key: "pmoInbox",
      name: PMO_INBOX_FOLDER_NAME,
      path: folders.pmoInbox,
      purpose: "Flagged emails and Teams messages for the PMO To-Do",
    },
    {
      key: "staffExchange",
      name: STAFF_EXCHANGE_FOLDER_NAME,
      path: folders.staffExchange,
      purpose: "Profile requests and M365 profiles for Staff Management",
    },
    {
      key: "ptoInbox",
      name: PTO_INBOX_FOLDER_NAME,
      path: folders.ptoInbox,
      purpose: "PTO emails for the shift roster",
    },
  ];
}

/** Every folder that has to exist, parents first. `only` limits it to some of the three
 *  (the AI-OS folder itself is always included). */
export function foldersToCreate(
  folders: AiOsFolders,
  only: readonly AiOsFolderKey[] = ["pmoInbox", "staffExchange", "ptoInbox"],
): string[] {
  return [
    folders.root,
    ...(only.includes("pmoInbox") ? [folders.pmoInbox] : []),
    ...(only.includes("staffExchange")
      ? [
          folders.staffExchange,
          ...STAFF_EXCHANGE_SUBFOLDERS.map((name) => join(folders.staffExchange, name)),
        ]
      : []),
    ...(only.includes("ptoInbox") ? [folders.ptoInbox] : []),
  ];
}

export interface EnsureResult {
  created: string[];
  failed: { path: string; reason: string }[];
}

/**
 * Creates the folders that are missing; one that exists is left alone (and never
 * emptied). `mkdir` creates one folder and may throw. Returns what it created and
 * what it could not, so a caller can say so instead of failing as a whole.
 */
export async function ensureAiOsFolders(
  folders: AiOsFolders,
  io: {
    isDirectory: (dir: string) => boolean;
    mkdir: (dir: string) => Promise<void>;
  },
  only?: readonly AiOsFolderKey[],
): Promise<EnsureResult> {
  const result: EnsureResult = { created: [], failed: [] };
  for (const dir of foldersToCreate(folders, only)) {
    if (io.isDirectory(dir)) continue;
    try {
      await io.mkdir(dir);
      result.created.push(dir);
    } catch (error) {
      result.failed.push({
        path: dir,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

/** Which of the three folders exist (the legacy locations count for the two old ones). */
export function folderStatus(
  oneDriveRoot: string,
  isDirectory: (dir: string) => boolean,
): { folders: AiOsFolders; found: Record<AiOsFolderKey, boolean>; rootFound: boolean } {
  const folders = aiOsFolders(oneDriveRoot);
  const legacy = legacyFolders(oneDriveRoot);
  return {
    folders,
    rootFound: isDirectory(folders.root),
    found: {
      pmoInbox: isDirectory(folders.pmoInbox) || isDirectory(legacy.pmoInbox),
      staffExchange:
        isDirectory(folders.staffExchange) || isDirectory(legacy.staffExchange),
      ptoInbox: isDirectory(folders.ptoInbox),
    },
  };
}

/**
 * The Staff-Exchange folder inside a OneDrive root. An install from before the AI-OS
 * folder keeps its own folder for as long as it is there: a Power Automate flow watches
 * that exact folder, so quietly switching to a new one would stop the flow working. A
 * fresh install has only the AI-OS one.
 */
export function pickStaffExchange(
  oneDriveRoot: string,
  isDirectory: (dir: string) => boolean,
): string {
  const legacy = legacyFolders(oneDriveRoot);
  return isDirectory(legacy.staffExchange)
    ? legacy.staffExchange
    : aiOsFolders(oneDriveRoot).staffExchange;
}
