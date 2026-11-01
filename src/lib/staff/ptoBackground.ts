// Reads the PTO-Inbox (and applies M365 profile files) on its own while PMO Desk runs, with no
// Staff window open: the person only has to approve what the AI filed. Started once from
// instrumentation.ts. Every step is idempotent and shares its in-flight scan with the Staff
// window's own sync, so the two never double up.
import { syncExchange } from "./exchangeServer";
import { kickPtoSync } from "./ptoMailAi";
import { FIRST_PTO_SCAN_MS, ptoScanInterval } from "./ptoScanInterval";

type Env = Record<string, string | undefined>;

declare global {
  var aiOsPtoBackground: ReturnType<typeof setInterval> | undefined;
}

async function tick(): Promise<void> {
  try {
    await syncExchange();
  } catch (error) {
    console.error("[staff] background profile sync failed:", error);
  }
  // Slow (a model reads each email): not awaited; a scan already running is joined.
  kickPtoSync();
}

/** Starts the background reader once per server process. Safe to call again. */
export function startPtoBackground(env: Env = process.env): void {
  if (globalThis.aiOsPtoBackground) return;
  const every = ptoScanInterval(env);
  if (every === null) return;
  const timer = setInterval(() => void tick(), every);
  timer.unref?.();
  globalThis.aiOsPtoBackground = timer;
  const first = setTimeout(() => void tick(), FIRST_PTO_SCAN_MS);
  first.unref?.();
}
