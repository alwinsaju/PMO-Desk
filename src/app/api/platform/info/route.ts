import { NextResponse } from "next/server";
import { platformInfo } from "@/lib/platform/appInfo";
import { gated } from "@/lib/platform/http";

export const dynamic = "force-dynamic";

/** GET /api/platform/info -> { ok, version, dataDir, files, bytes, desktop } */
export async function GET(request: Request) {
  return gated(request, async () =>
    NextResponse.json({ ok: true, ...(await platformInfo()) }),
  );
}
