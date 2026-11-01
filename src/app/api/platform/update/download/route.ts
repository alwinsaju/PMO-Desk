import { NextResponse } from "next/server";
import { appVersion } from "@/lib/platform/appInfo";
import { gated } from "@/lib/platform/http";
import { downloadInstaller, fetchManifest, isNewer } from "@/lib/platform/updates";
import os from "node:os";
import path from "node:path";

export const dynamic = "force-dynamic";

/** POST /api/platform/update/download { url } -> { ok, name }. The server reads the update file itself
 *  (the page cannot name an installer), downloads the installer into Downloads and checks its SHA-256.
 *  Starting the installer is a separate, explicit step in the desktop shell. */
export async function POST(request: Request) {
  return gated(request, async () => {
    const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    const found = url ? await fetchManifest(url) : null;
    if (!found || !found.ok) {
      return NextResponse.json({
        ok: false,
        reason: found && !found.ok ? found.reason : "Enter the update address first.",
      });
    }
    if (!isNewer(found.manifest.version, appVersion())) {
      return NextResponse.json({ ok: false, reason: "PMO Desk is already up to date." });
    }
    const dir =
      process.env.AI_OS_DOWNLOADS_DIR?.trim() || path.join(os.homedir(), "Downloads");
    const result = await downloadInstaller(found.manifest, dir);
    if (!result.ok || !result.file) {
      return NextResponse.json({
        ok: false,
        reason: result.reason ?? "The download failed.",
      });
    }
    return NextResponse.json({ ok: true, name: path.basename(result.file) });
  });
}
