import { NextResponse } from "next/server";
import { appVersion } from "@/lib/platform/appInfo";
import { exportCsvZip, exportJson, readExportData } from "@/lib/platform/dataExport";
import { download, gated, stampForName } from "@/lib/platform/http";
import { resolveDataDir } from "@/lib/pmo/server/paths";

export const dynamic = "force-dynamic";

/** POST /api/platform/export?kind=json|csv -> one JSON file, or a zip of CSV files Excel opens. */
export async function POST(request: Request) {
  return gated(request, async () => {
    const kind = new URL(request.url).searchParams.get("kind");
    if (kind !== "json" && kind !== "csv") {
      return NextResponse.json(
        { ok: false, reason: "Choose JSON or CSV." },
        { status: 400 },
      );
    }
    const now = new Date();
    const data = await readExportData(resolveDataDir());
    const stamp = stampForName(now);
    if (kind === "json") {
      return download(
        exportJson(data, now, appVersion()),
        `AI-OS-data-${stamp}.json`,
        "application/json",
      );
    }
    return download(exportCsvZip(data), `AI-OS-data-${stamp}.zip`, "application/zip");
  });
}
