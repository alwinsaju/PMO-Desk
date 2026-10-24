// Assembles the one document the UI polls (GET /api/pmo/state).
import { attentionSummary } from "../due.ts";
import { istDate } from "../time.ts";
import { teamsIsFiltering } from "../filter.ts";
import type { PmoState, RuntimeSummary } from "../types.ts";
import type { Pmo } from "./actions.ts";
import { resolveInboxDir } from "./paths.ts";

/** Decided to-dos and filtered items beyond these counts stay on disk only. */
const MAX_CLOSED_TODOS = 200;
const MAX_FILTERED_SHOWN = 200;

export const SCAN_INTERVAL_MS = 15_000;

export async function buildState(
  pmo: Pmo,
  deps: {
    runtime: () => Promise<RuntimeSummary>;
    dataDir: string;
    scanIntervalMs?: number;
  },
): Promise<PmoState> {
  const { store, ingestor, worker } = pmo;
  const [config, proposals, todos, quarantine, rejectedFileCount, runtime] =
    await Promise.all([
      store.loadConfig(),
      store.listProposals(),
      store.listTodos(),
      store.listQuarantine(),
      store.countRejectedFiles(),
      deps.runtime(),
    ]);

  const open = todos.filter((todo) => todo.status === "open");
  const closed = todos
    .filter((todo) => todo.status !== "open")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_CLOSED_TODOS);

  const last = ingestor.last;
  const now = pmo.now();
  return {
    ok: true,
    serverTime: now.toISOString(),
    today: istDate(now),
    queue: proposals.filter((p) =>
      ["pending", "structuring", "ready", "failed"].includes(p.status),
    ),
    todos: [...open, ...closed],
    attention: attentionSummary(open, now, config.reminders),
    filtered: quarantine.slice(0, MAX_FILTERED_SHOWN),
    ingest: {
      inboxDir: last?.inboxDir ?? resolveInboxDir(config.inboxDir),
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
      rejectedFileCount,
      teamsFiltering: teamsIsFiltering(config),
    },
    structuring: worker.state(),
    runtime,
    config,
    dataDir: deps.dataDir,
  };
}
