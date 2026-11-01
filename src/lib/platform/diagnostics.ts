// The diagnostics bundle for support: versions, health numbers and the recent part
// of the logs, with secrets and personal details removed. Server only. It never
// includes to-do or message text, names, email addresses or the AI call log.
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readAudit } from "./auditServer.ts";
import { listBackupFiles } from "./backup.ts";
import { readExportData } from "./dataExport.ts";
import { redact, tailLines } from "./redact.ts";
import { writeZip, type ZipEntry } from "./zip.ts";
import { pmoPaths } from "../pmo/server/paths.ts";

export const LOG_TAIL_LINES = 400;

export interface DiagnosticsInput {
  appVersion: string;
  now: Date;
  platform: string;
  release: string;
  arch: string;
  nodeVersion: string;
  /** The OS user name, removed from every log line. */
  userName: string;
  folderCounts: Record<string, { files: number; bytes: number }>;
  counts: Record<string, number>;
  /** Recent audit actions with their time: no user and no details. */
  auditActions: { at: string; action: string }[];
  desktopLog: string | null;
  ingestLog: string | null;
}

const README = [
  "PMO Desk diagnostics bundle",
  "",
  "What is inside: versions, counts of records, the size of each data folder, the recent",
  "audit actions (time and kind only) and the end of the desktop and ingest logs.",
  "",
  "What was removed: passwords, tokens, email addresses, long ids, user names inside",
  "paths and network paths. To-do and message text, names and the AI call log are never",
  "included. Read the files before you send them if you want to check.",
].join("\n");

export function buildDiagnostics(input: DiagnosticsInput): ZipEntry[] {
  const clean = (text: string) =>
    redact(tailLines(text, LOG_TAIL_LINES), [input.userName]);
  const summary = {
    generatedAt: input.now.toISOString(),
    appVersion: input.appVersion,
    system: {
      platform: input.platform,
      release: input.release,
      arch: input.arch,
      node: input.nodeVersion,
    },
    counts: input.counts,
    dataFolders: input.folderCounts,
  };
  const entries: ZipEntry[] = [
    { name: "README.txt", data: Buffer.from(README) },
    { name: "summary.json", data: Buffer.from(JSON.stringify(summary, null, 2)) },
    {
      name: "audit-actions.csv",
      data: Buffer.from(
        ["when,action", ...input.auditActions.map((a) => `${a.at},${a.action}`)].join(
          "\r\n",
        ),
      ),
    },
  ];
  if (input.desktopLog !== null) {
    entries.push({ name: "desktop-log.txt", data: Buffer.from(clean(input.desktopLog)) });
  }
  if (input.ingestLog !== null) {
    entries.push({ name: "ingest-log.txt", data: Buffer.from(clean(input.ingestLog)) });
  }
  return entries;
}

/** The desktop shell keeps its log beside desktop-prefs.json (AI_OS_DESKTOP_PREFS_FILE). */
export function desktopLogPath(env: Record<string, string | undefined>): string | null {
  const prefs = env.AI_OS_DESKTOP_PREFS_FILE?.trim();
  return prefs ? path.join(path.dirname(path.resolve(prefs)), "desktop.log") : null;
}

const readOrNull = (file: string) => readFile(file, "utf8").catch(() => null);

export async function collectDiagnostics(
  root: string,
  options: { appVersion: string; now?: Date; env?: Record<string, string | undefined> },
): Promise<Buffer> {
  const env = options.env ?? process.env;
  const files = await listBackupFiles(root);
  const folderCounts: DiagnosticsInput["folderCounts"] = {};
  for (const file of files) {
    const top = file.rel.includes("/") ? file.rel.split("/")[0]! : "(root)";
    const slot = (folderCounts[top] ??= { files: 0, bytes: 0 });
    slot.files += 1;
    slot.bytes += file.size;
  }
  const data = await readExportData(root);
  const audit = await readAudit(root, 500);
  const logFile = desktopLogPath(env);
  let userName = "";
  try {
    userName = os.userInfo().username;
  } catch {
    userName = env.USERNAME ?? "";
  }
  const entries = buildDiagnostics({
    appVersion: options.appVersion,
    now: options.now ?? new Date(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    nodeVersion: process.version,
    userName,
    folderCounts,
    counts: {
      todos: data.todos.length,
      archivedTodos: data.archivedTodos.length,
      people: data.employees.length,
      timeOff: data.timeOff.length,
      templates: data.templates.length,
      registerRecords: Object.values(data.registers).reduce(
        (n, rows) => n + rows.length,
        0,
      ),
    },
    auditActions: audit.entries.map((e) => ({ at: e.at, action: e.action })),
    desktopLog: logFile ? await readOrNull(logFile) : null,
    ingestLog: await readOrNull(pmoPaths(root).ingestLog),
  });
  return writeZip(entries);
}
