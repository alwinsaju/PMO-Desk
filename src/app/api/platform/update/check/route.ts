import { NextResponse } from "next/server";
import { appVersion } from "@/lib/platform/appInfo";
import { gated } from "@/lib/platform/http";
import { fetchManifest, isNewer } from "@/lib/platform/updates";

export const dynamic = "force-dynamic";

/** POST /api/platform/update/check { url } -> { ok, current, available, manifest? }.
 *  Only called after the person turned the update check on. Reads one small JSON file; installs nothing. */
export async function POST(request: Request) {
  return gated(request, async () => {
    const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (!url) {
      return NextResponse.json(
        { ok: false, reason: "Enter the update address first." },
        { status: 400 },
      );
    }
    const result = await fetchManifest(url);
    if (!result.ok) return NextResponse.json({ ok: false, reason: result.reason });
    const current = appVersion();
    return NextResponse.json({
      ok: true,
      current,
      available: isNewer(result.manifest.version, current),
      manifest: result.manifest,
    });
  });
}
