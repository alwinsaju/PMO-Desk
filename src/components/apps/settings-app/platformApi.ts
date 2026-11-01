// Client for the /api/platform routes (same origin, local only). A failure is a value,
// not a throw, with a plain-language reason.
import { explainError } from "@/lib/platform/friendlyError";
import type { AuditEntry } from "@/lib/platform/auditView";
import type { BackupManifest } from "@/lib/platform/backup";
import type { UpdateManifest } from "@/lib/platform/updates";

export type Reply<T extends object = object> =
  ({ ok: true } & T) | { ok: false; reason: string; detail?: string };

const failure = (
  error: unknown,
  status?: number,
  where = "",
): { ok: false; reason: string; detail: string } => {
  const plain = explainError(error, { status });
  const context = [status ? `HTTP ${status}` : "", where].filter(Boolean).join(" ");
  return {
    ok: false,
    reason: plain.message,
    detail: [context, plain.detail].filter(Boolean).join(": "),
  };
};

async function json<T extends object>(
  path: string,
  init?: RequestInit,
): Promise<Reply<T>> {
  try {
    const response = await fetch(`/api/platform/${path}`, { cache: "no-store", ...init });
    const body = (await response.json().catch(() => null)) as Reply<T> | null;
    if (body && body.ok === false) {
      return { ...body, detail: failure(body.reason, response.status, path).detail };
    }
    if (body) return body;
    return failure("", response.status, path);
  } catch (error) {
    return failure(error, undefined, path);
  }
}

export interface PlatformInfo {
  version: string;
  dataDir: string;
  files: number;
  bytes: number;
  desktop: boolean;
  /** The computer account's name, used to greet the person on the lock screen. */
  account?: string;
}

export const fetchInfo = () => json<PlatformInfo>("info");
export const fetchAudit = () => json<{ entries: AuditEntry[]; total: number }>("audit");

export const checkBackup = (file: File) =>
  json<{ manifest: BackupManifest; files: number }>("restore?check=1", {
    method: "POST",
    body: file,
  });

export const restoreBackupFile = (file: File) =>
  json<{ restored: number; removed: number; safetyCopy: string }>("restore", {
    method: "POST",
    headers: { "X-AI-OS-Confirm": "restore" },
    body: file,
  });

export const checkForUpdate = (url: string) =>
  json<{ current: string; available: boolean; manifest: UpdateManifest }>(
    "update/check",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    },
  );

export const downloadUpdate = (url: string) =>
  json<{ name: string }>("update/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

/** POST to a route that returns a file, then hand the file to the person (a save dialog in the desktop app). */
export async function saveDownload(
  path: string,
  fallbackName: string,
): Promise<Reply<{ name: string }>> {
  try {
    const response = await fetch(`/api/platform/${path}`, {
      method: "POST",
      cache: "no-store",
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        reason?: string;
      } | null;
      return failure(body?.reason ?? "", response.status);
    }
    const disposition = response.headers.get("content-disposition") ?? "";
    const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { ok: true, name };
  } catch (error) {
    return failure(error);
  }
}

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
};
