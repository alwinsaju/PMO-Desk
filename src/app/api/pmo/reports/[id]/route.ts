import { getSavedReport, saveReportText } from "@/lib/pmo/server/actions";
import { readBodyCapped } from "@/lib/pmo/server/bodyCap";
import { handle } from "@/lib/pmo/server/http";
import { MAX_REPORT_CHARS } from "@/lib/pmo/server/reports";

export const dynamic = "force-dynamic";

/** GET /api/pmo/reports/[id]?rev=N -> a saved report's text (latest revision by
 *  default), its revision list and its full data. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const rev = Number(new URL(request.url).searchParams.get("rev"));
  return handle(request, (pmo) =>
    getSavedReport(pmo, id, Number.isInteger(rev) && rev > 0 ? rev : undefined),
  );
}

/** POST /api/pmo/reports/[id] { markdown, edited, ... } — save the (edited) text
 *  as a NEW revision file under <data dir>\reports; the first save creates the
 *  report. Local files only. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handle(request, async (pmo) => {
    const read = await readBodyCapped(request, MAX_REPORT_CHARS * 4 + 4096);
    if ("reason" in read) return { ok: false, reason: read.reason };
    return saveReportText(pmo, id, read.body);
  });
}
