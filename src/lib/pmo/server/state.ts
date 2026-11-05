// Assembles the one document the UI polls (GET /api/pmo/state).
import { attentionSummary } from "../due.ts";
import { isValidTimeZone, istDate } from "../time.ts";
import { teamsIsFiltering } from "../filter.ts";
import {
  emptyAttentionSummary,
  MAX_ATTENTION_NAMES,
  type PmoState,
  type RuntimeSummary,
} from "../types.ts";
import type { Pmo } from "./actions.ts";
import { resolveInboxDir } from "./paths.ts";

/** Decided to-dos and filtered items beyond these counts stay on disk only. */
const MAX_CLOSED_TODOS = 200;
const MAX_FILTERED_SHOWN = 200;
/** Rejected proposals offered for Restore. */
const MAX_REJECTED_SHOWN = 50;

export const SCAN_INTERVAL_MS = 15_000;

/** The few numbers behind the dock badge (GET /api/pmo/state?summary=1): never builds the
 *  whole state, and reads the to-dos from the store's unchanged-folder cache. */
export async function buildSummary(pmo: Pmo): Promise<{
  ok: true;
  summary: true;
  serverTime: string;
  today: string;
  attention: PmoState["attention"];
}> {
  const [config, todos] = await Promise.all([
    pmo.store.loadConfig(),
    pmo.store.listTodosShared(),
  ]);
  const now = pmo.now();
  return {
    ok: true,
    summary: true,
    serverTime: now.toISOString(),
    today: istDate(now, config.reminders.timeZone),
    attention: attentionSummary(
      todos.filter((todo) => todo.status === "open"),
      now,
      config.reminders,
    ),
  };
}

export async function buildState(
  pmo: Pmo,
  deps: {
    runtime: () => Promise<RuntimeSummary>;
    dataDir: string;
    scanIntervalMs?: number;
  },
): Promise<PmoState> {
  const { store, ingestor, worker } = pmo;
  const [config, proposals, todos, quarantine, parked, runtime] = await Promise.all([
    store.loadConfig(),
    store.listProposalsShared(),
    store.listTodosShared(),
    store.listQuarantine(),
    store.listRejectedFiles(MAX_ATTENTION_NAMES),
    deps.runtime(),
  ]);
  // After the listings above: reading is what moves unreadable files aside.
  const corrupt = await store.listCorrupt();

  const open = todos.filter((todo) => todo.status === "open");
  const closed = todos
    .filter((todo) => todo.status !== "open")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_CLOSED_TODOS);

  const last = ingestor.last;
  const now = pmo.now();
  const paused = worker.state().paused;
  const names = (list: readonly string[] | undefined) =>
    (list ?? []).slice(0, MAX_ATTENTION_NAMES);
  return {
    ok: true,
    serverTime: now.toISOString(),
    today: istDate(now, config.reminders.timeZone),
    queue: proposals.filter((p) =>
      ["pending", "structuring", "ready", "failed"].includes(p.status),
    ),
    rejected: proposals
      .filter((p) => p.status === "rejected")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, MAX_REJECTED_SHOWN),
    todos: [...open, ...closed],
    attention: attentionSummary(open, now, config.reminders),
    needsAttention: {
      ...emptyAttentionSummary(),
      corruptRecords: corrupt.length,
      corruptFileNames: corrupt.slice(-MAX_ATTENTION_NAMES),
      oversizedFiles: last?.oversized.length ?? 0,
      oversizedFileNames: names(last?.oversized),
      erroredFiles: last?.errored.length ?? 0,
      erroredFileNames: names(last?.errored),
      parkedFiles: parked.count,
      parkedFileNames: parked.names,
      foreignFiles: last?.foreign.length ?? 0,
      foreignFileNames: names(last?.foreign),
      duplicatesIgnored: ingestor.duplicatesIgnored,
      badTimeZone: !isValidTimeZone(config.reminders.timeZone),
      queuePaused: paused !== null,
      modelMissing: paused?.code === "model-missing",
    },
    filtered: quarantine.slice(0, MAX_FILTERED_SHOWN),
    ingest: {
      inboxDir: last?.inboxDir ?? resolveInboxDir(config.inboxDir),
      configured: last?.configured ?? false,
      inboxExists: last?.inboxExists ?? false,
      scanIntervalMs: deps.scanIntervalMs ?? SCAN_INTERVAL_MS,
      lastScanAt: last?.at ?? null,
      errors: last?.errors ?? [],
      lastScan: last
        ? {
            ingested: last.ingested,
            duplicates: last.duplicates,
            filtered: last.filtered,
            rejected: last.rejected,
          }
        : null,
      filteredCount: quarantine.length,
      rejectedFileCount: parked.count,
      teamsFiltering: teamsIsFiltering(config),
    },
    structuring: worker.state(),
    runtime,
    config,
    dataDir: deps.dataDir,
    chasers: pmo.chaser.snapshot(),
    signoffDrafts: pmo.signoffDrafts.snapshot(),
  };
}
