// Server-side check behind /api/browser/check-embeddable: may this URL be shown
// in the Browser app's iframe? It fetches third-party URLs on request, so it
// must never be steerable at this machine or its network (SSRF):
//  - literal hosts and every DNS answer are refused when private, loopback,
//    link-local, CGNAT, reserved or an IPv6 form embedding such an IPv4;
//  - redirects are followed by hand (limit 5) and each hop is re-validated;
//  - an HTTP error status means the page will not render, so not embeddable.
// DNS is resolved once for the check and again by fetch, so a host that changes
// its answer in between could still slip through; only a boolean ever leaves here.
import { isIP } from "node:net";

export const MAX_REDIRECTS = 5;

export type Resolver = (hostname: string) => Promise<string[]>;
export type FetchHead = (url: string) => Promise<Response>;

function isPrivateIPv4(octets: number[]): boolean {
  const [a, b, c] = octets;
  return (
    a === 0 || // "this network"
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a === 127 ||
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protocol + TEST-NET-1
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 // multicast, reserved, broadcast
  );
}

/** Eight 16-bit groups of an IPv6 address (dotted IPv4 tail allowed), or null. */
function parseIPv6(address: string): number[] | null {
  let text = address.toLowerCase();
  const tail = text.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (tail) {
    const [x, y, z, w] = tail.slice(2).map(Number);
    text = `${tail[1]}${((x << 8) | y).toString(16)}:${((z << 8) | w).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...rest].map((g) =>
    parseInt(g, 16),
  );
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff)
    ? groups
    : null;
}

const v4From = (hi: number, lo: number) => [hi >> 8, hi & 255, lo >> 8, lo & 255];

/** True for any address this check must refuse (and for anything unparseable). */
export function isPrivateAddress(address: string): boolean {
  const host = address.replace(/^\[|\]$/g, "");
  const kind = isIP(host);
  if (kind === 4) return isPrivateIPv4(host.split(".").map(Number));
  if (kind !== 6) return true;

  const g = parseIPv6(host);
  if (!g) return true;
  if (g.slice(0, 6).every((x) => x === 0)) return isPrivateIPv4(v4From(g[6], g[7])); // ::, ::1, ::a.b.c.d
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return isPrivateIPv4(v4From(g[6], g[7])); // IPv4-mapped
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPrivateIPv4(v4From(g[6], g[7])); // NAT64
  }
  if (g[0] === 0x2002) return isPrivateIPv4(v4From(g[1], g[2])); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard
  return (
    (g[0] & 0xfe00) === 0xfc00 || // unique local
    (g[0] & 0xffc0) === 0xfe80 || // link-local
    (g[0] & 0xffc0) === 0xfec0 || // site-local
    g[0] >> 8 === 0xff // multicast
  );
}

/** A plain http(s) URL whose host is not obviously local; null otherwise. */
export function parseCheckableUrl(value: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return null;
  if (isIP(host) !== 0 && isPrivateAddress(host)) return null;
  return parsed;
}

const LOOPBACK_REASON =
  "That address points at this computer (loopback), so it can't be shown here.";
const PRIVATE_REASON = "That address is on a private network, so it can't be shown here.";

function isLoopbackAddress(address: string): boolean {
  const host = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (isIP(host) === 0) return false;
  if (isIP(host) === 4) return host.startsWith("127.") || host === "0.0.0.0";
  return host === "::1" || host === "::" || /^::ffff:(?:127\.|7f)/.test(host);
}

/** Why `value` can never be checked or embedded (loopback, private, not http(s),
 *  not an address); null when it is a public http(s) URL worth checking. */
export function refusalReason(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "That is not a web address.";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Only http and https addresses can be shown here.";
  }
  if (parseCheckableUrl(value)) return null;
  return isLoopbackAddress(parsed.hostname) ? LOOPBACK_REASON : PRIVATE_REASON;
}

export type EmbedVerdict = { embeddable: true } | { embeddable: false; reason: string };

/** Null when every address `url`'s host resolves to is public, else the reason. */
async function hostRefusal(url: URL, resolve: Resolver): Promise<string | null> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) {
    if (!isPrivateAddress(host)) return null;
    return isLoopbackAddress(host) ? LOOPBACK_REASON : PRIVATE_REASON;
  }
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return "That address could not be found. Check the spelling.";
  }
  if (addresses.length === 0)
    return "That address could not be found. Check the spelling.";
  const bad = addresses.find((a) => isPrivateAddress(a));
  if (bad === undefined) return null;
  return isLoopbackAddress(bad) ? LOOPBACK_REASON : PRIVATE_REASON;
}
/**
 * Mirrors the two real-world signals appCatalog.ts's comments name:
 * `X-Frame-Options` and the CSP `frame-ancestors` directive. This project only
 * embeds at its own origin, which no third party's allowlist names, so ANY
 * `X-Frame-Options` value blocks it, and any `frame-ancestors` other than `*` too.
 */
export function allowsFraming(headers: Headers): boolean {
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

const FRAMING_REASON = "The site doesn't allow itself to be shown inside another page.";
const REDIRECT_REASON = "The site redirected too many times (or to a bad address).";

/**
 * HEAD `start` (like `curl -sI`), following redirects by hand with every hop
 * validated, and say WHY when it cannot be embedded. `fetchHead` must NOT
 * follow redirects itself.
 */
export async function inspectEmbeddable(
  start: URL,
  deps: { resolve: Resolver; fetchHead: FetchHead },
): Promise<EmbedVerdict> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const refusal = await hostRefusal(current, deps.resolve);
    if (refusal) return { embeddable: false, reason: refusal };
    let res: Response;
    try {
      res = await deps.fetchHead(current.toString());
    } catch {
      return { embeddable: false, reason: "The site could not be reached." };
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return { embeddable: false, reason: REDIRECT_REASON };
      let target: string;
      try {
        target = new URL(location, current).toString();
      } catch {
        return { embeddable: false, reason: REDIRECT_REASON };
      }
      const next = parseCheckableUrl(target);
      if (!next)
        return { embeddable: false, reason: refusalReason(target) ?? REDIRECT_REASON };
      current = next;
      continue;
    }
    if (res.status >= 400) {
      return { embeddable: false, reason: `The site answered with HTTP ${res.status}.` };
    }
    return allowsFraming(res.headers)
      ? { embeddable: true }
      : { embeddable: false, reason: FRAMING_REASON };
  }
  return { embeddable: false, reason: REDIRECT_REASON };
}

/** Boolean form of `inspectEmbeddable` (false for anything refused or failing). */
export async function checkEmbeddable(
  start: URL,
  deps: { resolve: Resolver; fetchHead: FetchHead },
): Promise<boolean> {
  return (await inspectEmbeddable(start, deps)).embeddable;
}
