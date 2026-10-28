import { importRoster, readRoster, saveRoster } from "@/lib/staff/server";
import { readCappedJson, staffHandler } from "@/lib/staff/http";

export const dynamic = "force-dynamic";

/** The import carries a year of shifts, so it may be larger than other requests. */
const MAX_IMPORT_BYTES = 12 * 1024 * 1024;

/** GET /api/staff/roster -> { ok, config }: schedules, teams, members and events of the
 *  shift roster (the starting configuration until something is saved). */
export function GET(request: Request) {
  return staffHandler(request, async () => ({ config: await readRoster() }));
}

/** PUT /api/staff/roster { config } -> { ok, config }. Replaces the configuration;
 *  shifts of people no longer in it are dropped. */
export function PUT(request: Request) {
  return staffHandler(request, async () => ({
    config: await saveRoster(await readCappedJson(request)),
  }));
}

/** POST /api/staff/roster { config, upsert? } -> { ok, config, assignments }. The
 *  workbook import: replaces the configuration and merges the shifts in. */
export function POST(request: Request) {
  return staffHandler(request, async () =>
    importRoster(await readCappedJson(request, MAX_IMPORT_BYTES)),
  );
}
