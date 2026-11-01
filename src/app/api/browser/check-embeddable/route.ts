import { lookup } from "node:dns/promises";
import { NextResponse } from "next/server";
import {
  inspectEmbeddable,
  parseCheckableUrl,
  refusalReason,
} from "../../../../lib/browser/embeddableCheck.ts";
import { guardApiRequest } from "../../../../lib/security/apiGuard.ts";

// A live request to a third-party site on every call: never cacheable.
export const dynamic = "force-dynamic";

/** Backs the Browser app's address bar, so a slow target fails fast (closed:
 *  the graceful new-tab fallback) instead of leaving the bar spinning. */
const CHECK_TIMEOUT_MS = 6000;

/** Some sites vary their framing headers for an unrecognised UA. */
const CHECK_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/**
 * GET /api/browser/check-embeddable?url=<url> -> { embeddable: boolean, reason?: string }
 * `reason` says why not (loopback, private network, HTTP status, framing...).
 * A loopback/private address is answered 200 with its reason; 400 is only for
 * input that is not an http(s) address at all.
 *
 * Runs server-side the check appCatalog.ts describes doing by hand (`curl -sI`,
 * look at X-Frame-Options and CSP frame-ancestors): client code cannot read
 * those headers cross-origin. All the SSRF hardening lives in
 * lib/browser/embeddableCheck.ts.
 */
export async function GET(request: Request) {
  const verdict = guardApiRequest(request, { checkReads: true });
  if (!verdict.ok) {
    return NextResponse.json(
      { embeddable: false, reason: verdict.reason },
      { status: 403 },
    );
  }

  const target = new URL(request.url).searchParams.get("url");
  const parsed = target ? parseCheckableUrl(target) : null;
  if (!parsed) {
    const reason = target ? refusalReason(target) : "That is not a web address.";
    const isLocal = Boolean(target) && /^https?:/i.test(target ?? "");
    return NextResponse.json(
      { embeddable: false, reason },
      { status: isLocal ? 200 : 400 },
    );
  }

  try {
    const result = await inspectEmbeddable(parsed, {
      resolve: async (hostname) =>
        (await lookup(hostname, { all: true, verbatim: true })).map((a) => a.address),
      fetchHead: (url) =>
        fetch(url, {
          method: "HEAD",
          redirect: "manual",
          signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
          headers: { "User-Agent": CHECK_USER_AGENT },
        }),
    });
    return NextResponse.json(result);
  } catch {
    // Timed out / anything else: treated like "blocked".
    return NextResponse.json({
      embeddable: false,
      reason: "The site did not answer in time.",
      code: "unreachable",
    });
  }
}
