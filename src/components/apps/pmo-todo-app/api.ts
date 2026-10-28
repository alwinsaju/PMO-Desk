// Client for the app's own /api/pmo routes (same origin; local files only).
// Mirrors the repo convention: HTTP 200 with an { ok, reason? } envelope, so
// a business failure is a value here and only a network failure throws.
import type {
  ChaserJob,
  PmoConfig,
  ReminderPrefs,
  PmoConfigPatch,
  PmoState,
  RawRecord,
  ReportNarrativeJob,
  Todo,
  TodoDraft,
} from "@/lib/pmo/types";
import type { PeriodRequest, SavedReportSummary } from "@/lib/pmo/report";
import type { FirstRunPayload } from "@/lib/pmo/firstRun";
import type { FirstRunSuggestions } from "@/lib/pmo/server/firstRun";
import type { ManualPasteInput } from "@/lib/pmo/manualIntake";
import type { Attention, DueNotification, Toast } from "@/lib/pmo/due";
import type { TodoPatch } from "@/lib/pmo/todoLogic";
import type { RecordableOutcome } from "@/lib/pmo/signoff";
import type { GeneratedReport, OpenedReport, saveBody } from "./reportView";

const BASE = "/api/pmo";
const TIMEOUT_MS = 15_000;

export type Reply<T extends object = object> =
  ({ ok: true } & T) | { ok: false; reason: string };

async function call<T extends object>(
  path: string,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE" = "GET",
  body?: unknown,
): Promise<Reply<T>> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  try {
    return (await response.json()) as Reply<T>;
  } catch {
    return {
      ok: false,
      reason: `Unexpected reply from the app server (HTTP ${response.status}).`,
    };
  }
}

/** Throws when the server can't be reached or refuses (so the poller can show "offline"). */
export async function fetchState(): Promise<PmoState> {
  const reply = await call<PmoState>("/state");
  if (!reply.ok) throw new Error(reply.reason);
  return reply;
}

export const scanNow = () =>
  call<{
    report: { ingested: number; duplicates: number; filtered: number; rejected: number };
  }>("/ingest/scan", "POST");

export const approveProposal = (id: string, draft: TodoDraft) =>
  call<{ todo: Todo }>(`/queue/${id}/approve`, "POST", { draft });
export const rejectProposal = (id: string) => call(`/queue/${id}/reject`, "POST");
/** Undo of Reject: the proposal goes back to the queue. */
export const restoreProposal = (id: string) => call(`/queue/${id}/restore`, "POST");
export const retryProposal = (id: string) => call(`/queue/${id}/retry`, "POST");
/** Apply an "update to existing to-do" card: `include` = the ticked change ids. */
export const applyUpdate = (id: string, include?: string[]) =>
  call<{ todo: Todo }>(`/queue/${id}/apply`, "POST", { include });
/** "Create as separate to-do instead". */
export const separateUpdate = (id: string) => call(`/queue/${id}/separate`, "POST");
export const stageEdits = (id: string, draft: TodoDraft) =>
  call(`/queue/${id}`, "PATCH", { draft });

export const fetchRaw = (intakeId: string) =>
  call<{ record: RawRecord }>(`/raw/${intakeId}`);

export const createTodo = (draft: TodoDraft, proposalId?: string) =>
  call<{ todo: Todo }>("/todos", "POST", { draft, proposalId });
export const patchTodo = (id: string, patch: TodoPatch) =>
  call<{
    todo: Todo;
    offerDone: boolean;
    nextOccurrence: { dueAt: string; title: string } | null;
  }>(`/todos/${id}`, "PATCH", patch);

/** A repeating to-do that was just marked done, and when the next round is due.
 *  Held by the app until the person creates the next one or moves on. */
export interface NextOffer {
  todo: Todo;
  dueAt: string;
}

// --- chaser drafts: local model, text to copy, never sent ------------------------

export const startChaser = (todoId: string) =>
  call<{ job: ChaserJob }>(`/todos/${todoId}/chaser`, "POST");
export const discardChaser = (todoId: string) =>
  call(`/todos/${todoId}/chaser`, "DELETE");

// --- sign-off (phase 6): the server stamps who and when; nothing is sent ----------------

type SignoffReply = { todo: Todo };
/** "I've sent it": the person says the request went out. The server records the
 *  time and the OS user; the client sends only the approver. */
export const requestSignoff = (
  todoId: string,
  body: { checkpointId?: string; approver?: string | null },
) => call<SignoffReply>(`/todos/${todoId}/signoff/request`, "POST", body);
/** Record the answer. Who recorded it and when are decided by the server. */
export const recordSignoff = (
  todoId: string,
  body: {
    checkpointId?: string;
    outcome: RecordableOutcome;
    conditions?: string;
    note?: string;
    intakeId?: string | null;
  },
) => call<SignoffReply>(`/todos/${todoId}/signoff/record`, "POST", body);
export const confirmSignoffConditions = (todoId: string, checkpointId?: string) =>
  call<SignoffReply>(`/todos/${todoId}/signoff/conditions`, "POST", { checkpointId });
/** The only undo of a recorded sign-off; the reason is required. */
export const revokeSignoff = (todoId: string, reason: string, checkpointId?: string) =>
  call<SignoffReply>(`/todos/${todoId}/signoff/revoke`, "POST", { checkpointId, reason });
/** The optional "improve with AI" text (local model, copy-only). */
export const startSignoffDraft = (todoId: string, approver: string | null) =>
  call<{ job: ChaserJob }>(`/todos/${todoId}/signoff/draft`, "POST", { approver });
export const discardSignoffDraft = (todoId: string) =>
  call(`/todos/${todoId}/signoff/draft`, "DELETE");

// --- weekly report: built by code, local text, never sent ------------------------------

/** Instant, deterministic; nothing is saved until `saveReport`. */
export const generateReport = (period: PeriodRequest) =>
  call<GeneratedReport>("/reports", "POST", { period });
/** Ask the LOCAL model for highlights (a background job; poll `fetchReportNarrative`). */
export const startReportNarrative = (period: PeriodRequest) =>
  call<{ job: ReportNarrativeJob }>("/reports/narrative", "POST", { period });
export const fetchReportNarrative = (key: string) =>
  call<{ job: ReportNarrativeJob | null }>(
    `/reports/narrative?key=${encodeURIComponent(key)}`,
  );
export const listReports = () => call<{ reports: SavedReportSummary[] }>("/reports");
export const fetchReport = (id: string) => call<OpenedReport>(`/reports/${id}`);
/** Saves the text as a NEW revision file in the data folder. */
export const saveReport = (id: string, body: ReturnType<typeof saveBody>) =>
  call<{ id: string; revision: number; savedAt: string }>(`/reports/${id}`, "POST", body);

export const updateConfig = (patch: PmoConfigPatch) =>
  call<{ config: PmoConfig }>("/config", "PUT", patch);

// --- first run (server/firstRun.ts): nothing is created or saved before the person clicks ---

/** A refusal; `needsConfirmation` means "this folder holds other JSON: ask first". */
export type FirstRunReply<T extends object = object> =
  ({ ok: true } & T) | { ok: false; reason: string; needsConfirmation?: true };

export const fetchFirstRunSuggestions = () => call<FirstRunSuggestions>("/setup");
export const finishFirstRun = (body: FirstRunPayload & { confirmNonEmpty?: boolean }) =>
  call<{ config: PmoConfig }>("/setup", "POST", body) as Promise<
    FirstRunReply<{ config: PmoConfig }>
  >;
/** The "Create PMO-Inbox here" button: the only thing that makes the folder. */
export const createInboxFolder = (parent: string, confirmNonEmpty = false) =>
  call<{ path: string; created: boolean }>("/setup/create-folder", "POST", {
    parent,
    confirmNonEmpty,
  }) as Promise<FirstRunReply<{ path: string; created: boolean }>>;

export const submitPaste = (paste: ManualPasteInput) =>
  call<{ duplicate: boolean; fileName: string | null; wouldFilter: string | null }>(
    "/intake/manual",
    "POST",
    paste,
  );

// --- reminders (see src/lib/pmo/due.ts and server/notify.ts) -----------------

/** Read-only: the attention counts behind the dock badge. Records nothing. */
export const fetchDue = () =>
  call<{
    now: string;
    today: string;
    pending: DueNotification[];
    attention: Attention;
    prefs: ReminderPrefs;
  }>("/due");

export interface ClaimReply {
  claimId: string | null;
  notifications: DueNotification[];
  toast: Toast | null;
  attention: Attention;
  prefs: ReminderPrefs;
}

/** Claim the reminders nobody has shown yet; `desktopOwns` comes back when the
 *  server belongs to the Electron shell, which delivers them itself. */
export const claimReminders = (client: string) =>
  call<ClaimReply>("/due/claim", "POST", { client }) as Promise<
    ({ ok: true } & ClaimReply) | { ok: false; reason: string; desktopOwns?: boolean }
  >;
export const acknowledgeReminders = (claimId: string) =>
  call<{ acknowledged: number }>("/due/ack", "POST", { claimId });
