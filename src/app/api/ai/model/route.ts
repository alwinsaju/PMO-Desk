import { NextResponse } from "next/server";
import { chooseActiveModel, getModelOptions } from "@/lib/ai-runtime";
import { readBodyCapped } from "@/lib/pmo/server/bodyCap";
import { checkOrigin, factsFromRequest } from "@/lib/pmo/server/originCheck";

export const dynamic = "force-dynamic";

function refuse(request: Request): NextResponse | null {
  const verdict = checkOrigin(factsFromRequest(request));
  return verdict.ok
    ? null
    : NextResponse.json({ ok: false, reason: verdict.reason }, { status: 403 });
}

/** GET /api/ai/model -> { ok, active, preferred, options: [{ id, kind, installed }] }:
 *  the model calls use now and the two the "Fast AI model" switch chooses between.
 *  Read-only (it only asks Ollama which models are installed). */
export async function GET(request: Request) {
  const refused = refuse(request);
  if (refused) return refused;
  try {
    return NextResponse.json({ ok: true, ...(await getModelOptions()) });
  } catch (error) {
    console.error("[ai-model] status failed:", error);
    return NextResponse.json({ ok: false, reason: "Could not read the model choice." });
  }
}

/** POST /api/ai/model { model } -> { ok, reason? }: which model calls use from now on.
 *  Only an installed model of the allowed list is accepted; a missing one is downloaded
 *  through /api/setup (pull-model), which saves the choice itself. */
export async function POST(request: Request) {
  const refused = refuse(request);
  if (refused) return refused;
  const read = await readBodyCapped(request, 2048);
  if (!("body" in read)) return NextResponse.json({ ok: false, reason: read.reason });
  const model = (read.body as { model?: unknown } | null)?.model;
  if (typeof model !== "string") {
    return NextResponse.json({ ok: false, reason: "Say which model to use." });
  }
  const current = await getModelOptions();
  const wanted = current.options.find(
    (o) => o.id.toLowerCase() === model.trim().toLowerCase(),
  );
  if (!wanted)
    return NextResponse.json({
      ok: false,
      reason: `${model} is not a model PMO Desk can switch to.`,
    });
  if (wanted.installed === false) {
    return NextResponse.json({
      ok: false,
      reason: `${wanted.id} is not downloaded yet.`,
      needsDownload: true,
    });
  }
  return NextResponse.json(chooseActiveModel(wanted.id));
}
