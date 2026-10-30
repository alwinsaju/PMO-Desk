// Reads the audit log files for the Activity viewer. Server only.
import { readFile } from "node:fs/promises";
import { AUDIT_KEEP, rotatedName } from "../pmo/server/fsx.ts";
import { pmoPaths } from "../pmo/server/paths.ts";
import { parseAuditText, type AuditEntry } from "./auditView.ts";

export const AUDIT_VIEW_LIMIT = 2000;

/** The newest entries across audit.jsonl and its rotated copies. */
export async function readAudit(
  root: string,
  limit = AUDIT_VIEW_LIMIT,
): Promise<{ entries: AuditEntry[]; total: number }> {
  const file = pmoPaths(root).audit;
  const names = [
    file,
    ...Array.from({ length: AUDIT_KEEP }, (_, i) => rotatedName(file, i + 1)),
  ];
  const all: AuditEntry[] = [];
  for (const name of names) {
    const text = await readFile(name, "utf8").catch(() => "");
    all.push(...parseAuditText(text));
  }
  all.sort((a, b) => b.at.localeCompare(a.at));
  return { entries: all.slice(0, limit), total: all.length };
}
