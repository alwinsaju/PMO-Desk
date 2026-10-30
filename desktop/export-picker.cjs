// Picks an exported workbook for the Tasks app's Run form (pure; no Electron imports).
// The page never names a path: it asks for the newest matching file in the Downloads
// folder (the shell supplies that folder) or for a file chosen in a native dialog.

const path = require("node:path");

/** The largest workbook the shell will hand to the page. */
const MAX_BYTES = 60 * 1024 * 1024;

/**
 * @param {unknown} extensions e.g. [".xlsx"]
 * @returns {string[]} lower-case extensions that start with a dot (letters and digits only)
 */
function cleanExtensions(extensions) {
  if (!Array.isArray(extensions)) return [];
  return extensions
    .filter((e) => typeof e === "string" && /^\.[a-z0-9]{1,8}$/i.test(e))
    .map((e) => e.toLowerCase())
    .slice(0, 6);
}

/** A bare file name: no folders, no dots-only tricks, not an Office lock file, and one of the extensions. */
function isSafeName(name, extensions) {
  if (typeof name !== "string" || name.length === 0 || name.length > 200) return false;
  if (name !== path.basename(name) || name.includes("/") || name.includes("\\"))
    return false;
  if (name.startsWith("~$") || name.startsWith(".")) return false;
  const exts = cleanExtensions(extensions);
  return exts.length > 0 && exts.includes(path.extname(name).toLowerCase());
}

/**
 * @param {{name: string, mtimeMs: number, size: number, isFile: boolean}[]} entries
 * @param {{extensions?: unknown, prefix?: unknown}} want
 * @returns {{name: string, mtimeMs: number, size: number} | null} the most recently changed match
 */
function newestMatching(entries, want = {}) {
  const prefix =
    typeof want.prefix === "string" ? want.prefix.toLowerCase().slice(0, 40) : "";
  let best = null;
  for (const entry of entries) {
    if (!entry.isFile || !isSafeName(entry.name, want.extensions)) continue;
    if (entry.size > MAX_BYTES) continue;
    if (prefix && !entry.name.toLowerCase().startsWith(prefix)) continue;
    if (!best || entry.mtimeMs > best.mtimeMs) best = entry;
  }
  return best ? { name: best.name, mtimeMs: best.mtimeMs, size: best.size } : null;
}

module.exports = { MAX_BYTES, cleanExtensions, isSafeName, newestMatching };
