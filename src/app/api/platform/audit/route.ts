import { NextResponse } from "next/server";
import { readAudit } from "@/lib/platform/auditServer";
import { gated } from "@/lib/platform/http";
import { resolveDataDir } from "@/lib/pmo/server/paths";

export const dynamic = "force-dynamic";

/** GET /api/platform/audit -> { ok, entries (newest first, up to 2000), total } */
export async function GET(request: Request) {
  return gated(request, async () =>
    NextResponse.json({ ok: true, ...(await readAudit(resolveDataDir())) }),
  );
}
