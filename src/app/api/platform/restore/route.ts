import { NextResponse } from "next/server";
import { appVersion } from "@/lib/platform/appInfo";
import { inspectBackup, restoreBackup } from "@/lib/platform/backup";
import { gated } from "@/lib/platform/http";
import { mutexFor } from "@/lib/pmo/server/fsx";
import { resolveDataDir } from "@/lib/pmo/server/paths";
import { BodyTooLargeError, readBytesBounded } from "@/lib/security/boundedBody";

export const dynamic = "force-dynamic";

const MAX_BACKUP_BYTES = 512 * 1024 * 1024;

/** POST /api/platform/restore (body: the backup zip). `?check=1` only reads it and says what it holds.
 *  Without `X-AI-OS-Confirm: restore` nothing is replaced. */
export async function POST(request: Request) {
  return gated(request, async () => {
    let zip: Uint8Array;
    try {
      zip = await readBytesBounded(request, MAX_BACKUP_BYTES);
    } catch (error) {
      if (!(error instanceof BodyTooLargeError)) throw error;
      return NextResponse.json(
        { ok: false, reason: "That backup is larger than 512 MB." },
        { status: 413 },
      );
    }
    const { manifest, entries } = inspectBackup(zip);
    const url = new URL(request.url);
    if (url.searchParams.get("check") === "1") {
      return NextResponse.json({ ok: true, manifest, files: entries.length });
    }
    if (request.headers.get("x-ai-os-confirm") !== "restore") {
      return NextResponse.json(
        { ok: false, reason: "Restoring needs your confirmation." },
        { status: 400 },
      );
    }
    const root = resolveDataDir();
    const result = await mutexFor(root).run(() =>
      restoreBackup(root, zip, { appVersion: appVersion() }),
    );
    return NextResponse.json({ ok: true, ...result });
  });
}
