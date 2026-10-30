// Client for the engine's /task-packs routes (add, list and remove tasks without reinstalling).
// A failure is a value with a plain-language reason, never a throw.
import { explainError } from "@/lib/platform/friendlyError";
import { engineFetch } from "../../../lib/tasks-engine/engineClient.ts";
import { getEngineUrl } from "./engineUrl.ts";

export interface PackSummary {
  id: string;
  name: string;
  packVersion: string;
  fingerprint: string;
}

export interface InspectedPack extends PackSummary {
  files: { path: string; size: number; runs: boolean }[];
  steps: { id: string; type: string; cmd: string | null }[];
  totalBytes: number;
}

export type PackReply<T extends object = object> =
  ({ ok: true } & T) | { ok: false; reason: string; detail?: string };

async function call<T extends object>(
  path: string,
  init: RequestInit = {},
): Promise<PackReply<T>> {
  try {
    const res = await engineFetch(`${await getEngineUrl()}${path}`, {
      ...init,
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => null)) as PackReply<T> | null;
    if (body && body.ok === false) {
      return { ...body, detail: `HTTP ${res.status} ${path}: ${body.reason}` };
    }
    if (body) return body;
    const plain = explainError("", { status: res.status });
    return { ok: false, reason: plain.message, detail: `HTTP ${res.status} ${path}` };
  } catch (error) {
    const plain = explainError(error);
    return { ok: false, reason: plain.message, detail: `${path}: ${plain.detail}` };
  }
}

export const fetchPacks = () => call<{ packs: PackSummary[] }>("/task-packs");

export const inspectPack = (file: Blob) =>
  call<{ pack: InspectedPack; installed: boolean }>("/task-packs/inspect", {
    method: "POST",
    body: file,
  });

export const installPack = (file: Blob, fingerprint: string) =>
  call<{ pack: InspectedPack }>(
    `/task-packs/install?fingerprint=${encodeURIComponent(fingerprint)}`,
    { method: "POST", body: file },
  );

export const removePack = (id: string) =>
  call(`/task-packs/${encodeURIComponent(id)}`, { method: "DELETE" });

export interface MailerAnswers {
  name: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  templateName: string;
  tableType: "xlsx" | "csv";
  columns: string[];
  attachTable: boolean;
}

export const createMailer = (answers: MailerAnswers) =>
  call<{ pack: InspectedPack }>("/task-packs/mailer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });
