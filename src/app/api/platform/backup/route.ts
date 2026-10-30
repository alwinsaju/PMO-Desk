import { appVersion } from "@/lib/platform/appInfo";
import { createBackup } from "@/lib/platform/backup";
import { download, gated, stampForName } from "@/lib/platform/http";
import { resolveDataDir } from "@/lib/pmo/server/paths";

export const dynamic = "force-dynamic";

/** POST /api/platform/backup -> a zip of the whole data folder (POST so another page cannot trigger it). */
export async function POST(request: Request) {
  return gated(request, async () => {
    const zip = await createBackup(resolveDataDir(), { appVersion: appVersion() });
    return download(
      zip,
      `AI-OS-backup-${stampForName(new Date())}.zip`,
      "application/zip",
    );
  });
}
