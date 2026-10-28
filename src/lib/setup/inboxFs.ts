// The one filesystem read behind the inbox folder check: the start of the first
// few `.json` files in a folder. Read-only; never lists subfolders.
import { closeSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { oneDriveFacts, type InboxSafetyFacts } from "./inbox.ts";

/** Enough to see a leading `"schema": "pmo-intake/1"` or to parse a small file. */
const HEAD_BYTES = 64 * 1024;

export function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** What the inbox-folder check needs about this computer (the PMO data folder,
 *  the program, OneDrive's library folders), for setup and the PMO first run. */
export function inboxSafetyFacts(
  dataRoot: string,
  env: Record<string, string | undefined> = process.env,
): InboxSafetyFacts {
  const localAppData = env.LOCALAPPDATA?.trim();
  return {
    home: os.homedir(),
    libraryRoots: oneDriveFacts(env, isDirectory).roots,
    protectedDirs: [
      dataRoot,
      process.cwd(),
      path.dirname(process.execPath),
      ...(localAppData ? [path.join(localAppData, "AI OS")] : []),
    ],
    sampleJsonFiles,
  };
}

export function sampleJsonFiles(
  dir: string,
  limit: number,
): { name: string; text: string }[] {
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.json$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
  return names.slice(0, limit).map((name) => {
    try {
      const fd = openSync(path.join(dir, name), "r");
      try {
        const buffer = Buffer.alloc(HEAD_BYTES);
        const read = readSync(fd, buffer, 0, HEAD_BYTES, 0);
        return { name, text: buffer.subarray(0, read).toString("utf8") };
      } finally {
        closeSync(fd);
      }
    } catch {
      return { name, text: "" };
    }
  });
}
