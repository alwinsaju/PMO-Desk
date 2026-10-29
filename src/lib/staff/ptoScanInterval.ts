// How often the background PTO reader looks. Pure (no imports), so plain Node can test it.
type Env = Record<string, string | undefined>;

export const DEFAULT_PTO_SCAN_MS = 60_000;
export const MIN_PTO_SCAN_MS = 5_000;
/** The first look waits a minute so the window opens and the app's own start-up work finishes
 *  first: reading an email loads a model, which takes most of the CPU for a while. */
export const FIRST_PTO_SCAN_MS = 60_000;

/** AI_OS_PTO_SCAN_MS, bounded below; 0, "off" or "false" turns the background reading off. */
export function ptoScanInterval(env: Env = process.env): number | null {
  const raw = env.AI_OS_PTO_SCAN_MS?.trim().toLowerCase();
  if (raw === "0" || raw === "off" || raw === "false") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.max(MIN_PTO_SCAN_MS, Math.floor(parsed))
    : DEFAULT_PTO_SCAN_MS;
}
