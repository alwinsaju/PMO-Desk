import { NextResponse } from "next/server";

// Performs a live, real HTTP request to a third-party site on every call —
// never safe to treat as static/cacheable content.
export const dynamic = "force-dynamic";

/** Same reasoning as tasks-engine/shared.ts's PROBE_TIMEOUT_MS: this backs
 *  an interactive "can I load this" check for the Browser app's address
 *  bar, so a slow/half-dead target should fail fast (closed — the
 *  graceful new-tab fallback) rather than leave the address bar's page
 *  spinning indefinitely. */
const CHECK_TIMEOUT_MS = 6000;

/** A generic desktop-browser UA. Some sites vary their framing headers (or
 *  even whether they answer at all) for an unrecognized/empty UA string,
 *  so this asks the same way a real browser tab would. */
const CHECK_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/**
 * GET /api/browser/check-embeddable?url=<url> -> { embeddable: boolean }
 *
 * Automates, for an arbitrary user-typed URL, the exact manual check
 * appCatalog.ts's comments describe doing by hand once for the App
 * Store's fixed catalog of real web apps (`curl -sI <url>`, following
 * redirects, looking for the `X-Frame-Options` header and the CSP
 * `frame-ancestors` directive). The Browser app's address bar has no fixed
 * catalog to hand-verify ahead of time — it accepts any URL a person
 * types — so this runs the same check live, per request, instead.
 *
 * This has to happen server-side, never in the browser: a cross-origin
 * `fetch` from client code either gets rejected outright by CORS (default
 * "cors" mode — most third-party sites don't send an
 * Access-Control-Allow-Origin for this origin) or succeeds as an opaque
 * response with every header stripped ("no-cors" mode). Either way client
 * JS can never read these two headers itself; a plain server-to-server
 * fetch isn't subject to CORS at all, so it can.
 *
 * See `useEmbeddableUrl` (src/lib/useEmbeddableUrl.ts) for the one client
 * hook that calls this — it's the only caller, and only when it has no
 * hand-verified flag to trust instead.
 */
export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get("url");
  const parsed = target ? parseCheckableUrl(target) : null;

  if (!parsed) {
    return NextResponse.json({ embeddable: false }, { status: 400 });
  }

  try {
    const headers = await fetchResponseHeaders(parsed.toString());
    return NextResponse.json({ embeddable: allowsFraming(headers) });
  } catch {
    // Fails closed — unreachable/timed-out/otherwise-erroring is treated
    // the same as "blocked", matching useEmbeddableUrl's own fail-closed
    // contract on its side of this same check.
    return NextResponse.json({ embeddable: false });
  }
}

/** Only ever a plain http(s) URL pointed at something outside this
 *  machine. Rejects the obvious localhost/private/link-local literal
 *  forms so this "fetch whatever URL a client passes and read its
 *  headers" endpoint can't be pointed straight back at this server's own
 *  network by naively passing e.g. `http://localhost:3000/...` or
 *  `http://169.254.169.254/...`. Deliberately NOT exhaustive SSRF
 *  hardening — it doesn't resolve DNS and re-check the resolved IP, or
 *  re-validate hosts reached via a redirect — just a cheap guard against
 *  the naive case, proportionate to this being a local desktop-shell demo
 *  rather than internet-facing production infrastructure. */
function parseCheckableUrl(value: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (isDisallowedHost(parsed.hostname)) return null;
  return parsed;
}

function isDisallowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0" || host === "::1" || host === "::") return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  }

  return false;
}

/** HEAD only, matching appCatalog.ts's own hand-verification methodology
 *  (`curl -sI` is a HEAD request) — this route only ever reads headers,
 *  never a body, so there is nothing a GET would reveal that HEAD doesn't. */
async function fetchResponseHeaders(target: string): Promise<Headers> {
  const res = await fetch(target, {
    method: "HEAD",
    redirect: "follow",
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    headers: { "User-Agent": CHECK_USER_AGENT },
  });
  return res.headers;
}

/**
 * Mirrors the two real-world signals appCatalog.ts's comments name:
 * `X-Frame-Options` and the CSP `frame-ancestors` directive. This project
 * only ever embeds at its own origin, which no third party's allowlist
 * names, so ANY `X-Frame-Options` value blocks it, and any
 * `frame-ancestors` value other than the wildcard `*` does too.
 */
function allowsFraming(headers: Headers): boolean {
  const xfo = headers.get("x-frame-options");
  if (xfo && xfo.trim() !== "") return false;

  const csp = headers.get("content-security-policy");
  if (csp) {
    const frameAncestors = csp
      .split(";")
      .map((directive) => directive.trim())
      .find((directive) => /^frame-ancestors\b/i.test(directive));
    if (frameAncestors) {
      const sources = frameAncestors.replace(/^frame-ancestors/i, "").trim();
      if (sources !== "*") return false;
    }
  }

  return true;
}
