// Dev-server warm-up (pure: `fetchImpl` is injected). `next dev` compiles each API route the
// first time it is requested, which made the first open of Staff Management wait several
// seconds. After a live-dev start the shell requests the read-only routes the main apps call
// first, a couple at a time, so they are compiled before the user gets there. Never throws.

/** Read-only GET routes with no side effects (no inbox poller, no model load). */
const WARM_ROUTES = [
  "/api/staff/employees",
  "/api/staff/shifts",
  "/api/staff/timeoff",
  "/api/staff/offboarded",
  "/api/staff/roster",
  "/api/pmo/config",
  "/api/pmo/reports",
  "/api/tasks-engine/status",
  // POST-only route that spawns the engine: the warm-up's GET is answered 405 by Next without
  // running the handler, but the route is still compiled, which is what made the first open fail.
  "/api/tasks-engine/start",
];

const DEFAULT_CONCURRENCY = 2;

/**
 * @param {{ baseUrl: string, fetchImpl?: typeof fetch, routes?: string[], concurrency?: number }} options
 * @returns {Promise<{ warmed: number, failed: number }>}
 */
async function warmDevRoutes({
  baseUrl,
  fetchImpl = fetch,
  routes = WARM_ROUTES,
  concurrency = DEFAULT_CONCURRENCY,
}) {
  const queue = [...routes];
  let warmed = 0;
  let failed = 0;
  async function worker() {
    for (let route = queue.shift(); route !== undefined; route = queue.shift()) {
      try {
        const response = await fetchImpl(new URL(route, baseUrl), {
          signal: AbortSignal.timeout(30_000),
        });
        await response.arrayBuffer();
        warmed += 1;
      } catch {
        failed += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return { warmed, failed };
}

module.exports = { warmDevRoutes, WARM_ROUTES };
