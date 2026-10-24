// Wires the PMO app together and keeps it alive for the life of the Next
// server: store, inbox poller and structuring worker, created lazily on the
// first /api/pmo/* call (`ensureIngest`) and kept on globalThis, because Next
// compiles each route into its own module graph and they must all share one
// poller and one queue.
import { createRuntimeGenerator, runtimeSummary } from "./aiGenerator.ts";
import type { Pmo } from "./actions.ts";
import { createPmo } from "./create.ts";
import type { Ingestor } from "./ingest.ts";
import { resolveDataDir } from "./paths.ts";
import { PURGE_INTERVAL_MS, purgeExpired } from "./retention.ts";
import { SCAN_INTERVAL_MS } from "./state.ts";
import { createStubGenerator } from "./stubGenerator.ts";
import type { RuntimeSummary } from "../types.ts";

export interface PmoService extends Pmo {
  dataDir: string;
  scanIntervalMs: number;
  runtime: () => Promise<RuntimeSummary>;
  /** One inbox pass followed by a nudge to the structuring queue. */
  scanNow: () => ReturnType<Ingestor["scan"]>;
}

declare global {
  var aiOsPmoService: Promise<PmoService> | undefined;
}

async function startService(): Promise<PmoService> {
  const dataDir = resolveDataDir();
  const stub = process.env.PMO_AI_STUB?.trim();
  const generator = stub
    ? createStubGenerator({
        dataDir,
        delayMs: Number(process.env.PMO_AI_STUB_DELAY_MS) || undefined,
      })
    : createRuntimeGenerator();
  const pmo = await createPmo({ dataDir, generator });
  const scanIntervalMs = Math.max(
    1_000,
    Number(process.env.AI_OS_PMO_SCAN_MS) || SCAN_INTERVAL_MS,
  );

  const scanNow = async () => {
    const report = await pmo.ingestor.scan();
    await pmo.worker.kick();
    return report;
  };

  await pmo.worker.start();
  const timer = setInterval(() => {
    scanNow().catch((error) => console.error("[pmo] scan failed:", error));
  }, scanIntervalMs);
  timer.unref();
  void scanNow().catch((error) => console.error("[pmo] first scan failed:", error));

  // Retention (retention.ts): once at start, then daily. Idempotent, and a
  // failure only means the next pass tries again.
  const purge = async () => {
    const config = await pmo.store.loadConfig();
    await purgeExpired(pmo.store, {
      now: pmo.now(),
      retentionDays: config.retentionDays,
    });
  };
  void purge().catch((error) => console.error("[pmo] purge failed:", error));
  setInterval(() => {
    purge().catch((error) => console.error("[pmo] purge failed:", error));
  }, PURGE_INTERVAL_MS).unref();

  return {
    ...pmo,
    dataDir,
    scanIntervalMs,
    scanNow,
    runtime: async () =>
      stub
        ? {
            state: "stub" as const,
            model: "stub",
            message: "Using the built-in test stub, not the local model.",
          }
        : runtimeSummary(),
  };
}

/** Start the poller if it isn't running yet; every /api/pmo route calls this. */
export function ensureIngest(): Promise<PmoService> {
  globalThis.aiOsPmoService ??= startService().catch((error) => {
    globalThis.aiOsPmoService = undefined; // let the next call try again
    throw error;
  });
  return globalThis.aiOsPmoService;
}
