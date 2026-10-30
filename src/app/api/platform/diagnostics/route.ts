import { appVersion } from "@/lib/platform/appInfo";
import { collectDiagnostics } from "@/lib/platform/diagnostics";
import { download, gated, stampForName } from "@/lib/platform/http";
import { resolveDataDir } from "@/lib/pmo/server/paths";

export const dynamic = "force-dynamic";

/** POST /api/platform/diagnostics -> a zip for support: versions, counts and logs with secrets removed. */
export async function POST(request: Request) {
  return gated(request, async () => {
    const zip = await collectDiagnostics(resolveDataDir(), { appVersion: appVersion() });
    return download(
      zip,
      `AI-OS-diagnostics-${stampForName(new Date())}.zip`,
      "application/zip",
    );
  });
}
