// Back up and restore the whole data folder (to-dos, queue, staff, templates, saved
// settings, the audit trail). Server only. A backup is one zip with a manifest.
// Restoring first saves the current data as a zip in `backups/`, then replaces the
// files; nothing outside the data folder is ever written.
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { readZip, unsafeEntryName, writeZip, ZipError, type ZipEntry } from "./zip.ts";

export const BACKUP_MANIFEST = "ai-os-backup.json";
export const BACKUP_FORMAT = "ai-os-backup";
/** Top-level folders that are not part of a backup: logs are diagnostics, `backups` holds the backups themselves. */
export const BACKUP_SKIP_DIRS: ReadonlySet<string> = new Set(["logs", "backups"]);
export const SAFETY_COPIES_KEPT = 3;

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: 1;
  createdAt: string;
  appVersion: string;
  files: number;
  bytes: number;
}

export interface FileInfo {
  rel: string;
  abs: string;
  size: number;
}

const isTemp = (name: string) => name.endsWith(".tmp");

/** Every regular file below `root` that belongs in a backup. Symlinks are skipped. */
export async function listBackupFiles(root: string): Promise<FileInfo[]> {
  const out: FileInfo[] = [];
  async function walk(dir: string, rel: string): Promise<void> {
    let names: import("node:fs").Dirent[];
    try {
      names = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of names) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (!rel && entry.isDirectory() && BACKUP_SKIP_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(abs, childRel);
      else if (entry.isFile() && !isTemp(entry.name)) {
        const info = await stat(abs).catch(() => null);
        if (info) out.push({ rel: childRel, abs, size: info.size });
      }
    }
  }
  await walk(root, "");
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** Total size and file count of the data folder, for Settings. */
export async function folderSize(
  root: string,
): Promise<{ files: number; bytes: number }> {
  const files = await listBackupFiles(root);
  return { files: files.length, bytes: files.reduce((sum, f) => sum + f.size, 0) };
}

export async function createBackup(
  root: string,
  options: { appVersion: string; now?: Date },
): Promise<Buffer> {
  const files = await listBackupFiles(root);
  const entries: ZipEntry[] = [];
  let bytes = 0;
  for (const file of files) {
    try {
      const data = await readFile(file.abs);
      bytes += data.length;
      entries.push({ name: file.rel, data });
    } catch {
      // A file that vanished or is locked while we read is skipped, not fatal.
    }
  }
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: 1,
    createdAt: (options.now ?? new Date()).toISOString(),
    appVersion: options.appVersion,
    files: entries.length,
    bytes,
  };
  return writeZip([
    { name: BACKUP_MANIFEST, data: Buffer.from(JSON.stringify(manifest, null, 2)) },
    ...entries,
  ]);
}

export interface InspectedBackup {
  manifest: BackupManifest;
  entries: ZipEntry[];
}

/** Read and validate a backup without touching any file. Throws ZipError with a plain reason. */
export function inspectBackup(zip: Uint8Array): InspectedBackup {
  const all = readZip(zip);
  const manifestEntry = all.find((e) => e.name === BACKUP_MANIFEST);
  if (!manifestEntry) throw new ZipError("This zip is not a PMO Desk backup.");
  let manifest: unknown;
  try {
    manifest = JSON.parse(Buffer.from(manifestEntry.data).toString("utf8"));
  } catch {
    throw new ZipError("The backup's description is damaged.");
  }
  const m = manifest as Partial<BackupManifest> | null;
  if (!m || m.format !== BACKUP_FORMAT || m.version !== 1) {
    throw new ZipError("This backup was made by a version this app cannot read.");
  }
  const entries = all.filter((e) => e.name !== BACKUP_MANIFEST);
  const folded = new Set<string>();
  for (const entry of entries) {
    const top = entry.name.split("/")[0] ?? "";
    const bad = unsafeEntryName(entry.name);
    if (bad) throw new ZipError(`Refused: ${bad}.`);
    if (BACKUP_SKIP_DIRS.has(top)) {
      throw new ZipError(`Refused: "${entry.name}" is not something a backup contains.`);
    }
    if (isTemp(entry.name)) throw new ZipError(`Refused: "${entry.name}".`);
    // Windows file names are case-insensitive, so these would overwrite each other.
    const key = entry.name.toLowerCase();
    if (folded.has(key)) {
      throw new ZipError(
        `Refused: "${entry.name}" has the same name as another file apart from capital letters.`,
      );
    }
    folded.add(key);
  }
  return { manifest: m as BackupManifest, entries };
}

async function writeBinaryAtomic(file: string, data: Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(temp, data);
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

const stamp = (now: Date) => now.toISOString().replace(/[:.]/g, "-");

async function pruneSafetyCopies(dir: string): Promise<void> {
  const names = (await readdir(dir).catch(() => [] as string[]))
    .filter((n) => n.startsWith("before-restore-") && n.endsWith(".zip"))
    .sort();
  for (const name of names.slice(0, Math.max(0, names.length - SAFETY_COPIES_KEPT))) {
    await unlink(path.join(dir, name)).catch(() => undefined);
  }
}

export interface RestoreResult {
  restored: number;
  removed: number;
  manifest: BackupManifest;
  /** The zip holding the data that was replaced. */
  safetyCopy: string;
}

/** A restore that could not finish. The data folder is back as it was; the message is for the person. */
export class RestoreFailedError extends ZipError {}

const WORK_PREFIX = ".restore-";

const inside = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return !(relative.startsWith("..") || path.isAbsolute(relative));
};

const partsOf = (rel: string) => rel.split("/");

async function moveFile(from: string, to: string): Promise<void> {
  await mkdir(path.dirname(to), { recursive: true });
  await rename(from, to);
}

/** Last resort if moving the old files back fails: write the safety copy's files over whatever is there. */
async function restoreFromSafetyCopy(root: string, safetyCopy: string): Promise<void> {
  const { entries } = inspectBackup(await readFile(safetyCopy));
  const keep = new Set(entries.map((e) => e.name));
  for (const file of await listBackupFiles(root)) {
    if (!keep.has(file.rel)) await rm(file.abs, { force: true });
  }
  for (const entry of entries) {
    await writeBinaryAtomic(path.join(root, ...partsOf(entry.name)), entry.data);
  }
}

/**
 * Replace the data folder's contents with a backup's, all or nothing. The current data
 * is saved first; the backup is written to a staging folder before anything is touched;
 * then the old files are moved aside and the new ones moved in. If any step fails the
 * old files are put back (from the safety copy if they cannot be moved back).
 */
export async function restoreBackup(
  root: string,
  zip: Uint8Array,
  options: { appVersion: string; now?: Date },
): Promise<RestoreResult> {
  const { manifest, entries } = inspectBackup(zip);
  const targets = entries.map((entry) => {
    const target = path.join(root, ...partsOf(entry.name));
    if (!inside(root, target)) {
      throw new ZipError(`Refused: "${entry.name}" is outside the data folder.`);
    }
    return { entry, target };
  });
  const now = options.now ?? new Date();
  const backupsDir = path.join(root, "backups");
  const safetyCopy = path.join(backupsDir, `before-restore-${stamp(now)}.zip`);
  await writeBinaryAtomic(
    safetyCopy,
    await createBackup(root, { appVersion: options.appVersion, now }),
  );
  await pruneSafetyCopies(backupsDir);

  const work = path.join(backupsDir, `${WORK_PREFIX}${randomBytes(4).toString("hex")}`);
  const staging = path.join(work, "new");
  const aside = path.join(work, "old");
  const failed = (cause: unknown, rolledBack: boolean) => {
    console.error("[platform] restore failed:", cause);
    return new RestoreFailedError(
      rolledBack
        ? "The restore could not be finished, so nothing was changed. Your data is exactly as it was."
        : `The restore could not be finished and your data may be incomplete. Your data before the restore is saved in ${safetyCopy}.`,
    );
  };

  try {
    for (const { entry } of targets) {
      await writeBinaryAtomic(path.join(staging, ...partsOf(entry.name)), entry.data);
    }
  } catch (error) {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
    throw failed(error, true);
  }

  const keep = new Set(entries.map((e) => e.name));
  const current = await listBackupFiles(root);
  const movedAside: string[] = [];
  const placed: string[] = [];
  let removed = 0;
  try {
    for (const file of current) {
      await moveFile(file.abs, path.join(aside, ...partsOf(file.rel)));
      movedAside.push(file.rel);
      if (!keep.has(file.rel)) removed += 1;
    }
    for (const { entry, target } of targets) {
      await moveFile(path.join(staging, ...partsOf(entry.name)), target);
      placed.push(target);
    }
  } catch (error) {
    let rolledBack = true;
    try {
      for (const target of placed) await rm(target, { force: true });
      for (const rel of movedAside) {
        await moveFile(
          path.join(aside, ...partsOf(rel)),
          path.join(root, ...partsOf(rel)),
        );
      }
    } catch {
      try {
        await restoreFromSafetyCopy(root, safetyCopy);
      } catch {
        rolledBack = false;
      }
    }
    if (rolledBack)
      await rm(work, { recursive: true, force: true }).catch(() => undefined);
    throw failed(error, rolledBack);
  }
  await rm(work, { recursive: true, force: true }).catch(() => undefined);
  return { restored: entries.length, removed, manifest, safetyCopy };
}
