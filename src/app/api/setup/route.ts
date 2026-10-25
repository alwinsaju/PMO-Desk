import { NextResponse } from "next/server";
import { checkOrigin, factsFromRequest } from "@/lib/pmo/server/originCheck";
import {
  cancel,
  getStatus,
  saveInbox,
  startInstall,
  startPull,
  startSelfTest,
  type ActionResult,
} from "@/lib/setup/server";

// Live machine state and background jobs: never cacheable.
export const dynamic = "force-dynamic";

function refuse(request: Request): NextResponse | null {
  const verdict = checkOrigin(factsFromRequest(request));
  return verdict.ok
    ? null
    : NextResponse.json({ ok: false, reason: verdict.reason }, { status: 403 });
}

/** GET /api/setup -> { ok, report, jobs }: what first-run setup found on this
 *  computer, plus the progress of the install / model download / self-test.
 *  Read-only: it never installs, downloads or starts anything. */
export async function GET(request: Request) {
  const refused = refuse(request);
  if (refused) return refused;
  try {
    // ?fresh=1 (the "Check again" button) re-reads the slow Outlook facts too.
    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    return NextResponse.json({ ok: true, ...(await getStatus(fresh)) });
  } catch (error) {
    console.error("[setup] status failed:", error);
    return NextResponse.json({
      ok: false,
      reason: error instanceof Error ? error.message : "Could not check this computer.",
    });
  }
}

/**
 * POST /api/setup { action, ... } -> { ok, reason? }. A fixed list of actions,
 * each one a fixed job: nothing in the request chooses a command, a URL or a
 * file to run. The model name is checked against the configured model and the
 * fallback; the inbox path is checked to be an existing folder. Jobs run in the
 * background; the screen follows them through GET.
 *
 *   install-ollama | cancel-install | pull-model { model? } | pull-fallback-model |
 *   cancel-pull | run-selftest | choose-inbox { path }
 */
export async function POST(request: Request) {
  const refused = refuse(request);
  if (refused) return refused;
  let body: { action?: unknown; model?: unknown; path?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "The request body must be JSON." });
  }

  let result: ActionResult;
  try {
    switch (body.action) {
      case "install-ollama":
        result = startInstall();
        break;
      case "cancel-install":
        result = cancel("install-ollama");
        break;
      case "pull-model":
        result = await startPull(
          typeof body.model === "string" ? body.model : undefined,
          false,
        );
        break;
      case "pull-fallback-model":
        result = await startPull(undefined, true);
        break;
      case "cancel-pull":
        result = cancel("pull-model");
        break;
      case "run-selftest":
        result = startSelfTest();
        break;
      case "choose-inbox":
        result = await saveInbox(body.path);
        break;
      default:
        result = { ok: false, reason: "Unknown action." };
    }
  } catch (error) {
    console.error("[setup] action failed:", error);
    result = {
      ok: false,
      reason: error instanceof Error ? error.message : "That did not work.",
    };
  }
  return NextResponse.json(result);
}
