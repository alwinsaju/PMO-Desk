import { applyProfileSync } from "@/lib/staff/server";
import { readCappedJson, staffHandler } from "@/lib/staff/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/staff/profile { email, firstName?, lastName?, homeOffice?, level?,
 * op?, phone?, photoBase64? } -> { ok, employee }.
 *
 * The hook for the M365 profile flow: fills the M365-sourced fields (and the
 * profile picture) of the person already on the roster with that email.
 * Fields that are missing or empty in the request are left as they are.
 * Like every /api route it only accepts loopback hosts and same-origin callers.
 */
export function POST(request: Request) {
  return staffHandler(request, async () => ({
    employee: await applyProfileSync(await readCappedJson(request, 2 * 1024 * 1024)),
  }));
}
