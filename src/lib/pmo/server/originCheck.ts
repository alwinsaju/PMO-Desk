// Guards every /api/pmo route. The routes serve raw message text, so a web
// page in the same browser must not be able to read or drive them:
//  - cross-site requests are refused (Origin / Sec-Fetch-Site), and
//  - the Host must be a loopback name, which stops DNS-rebinding (a hostile
//    domain re-pointed at 127.0.0.1 still sends its own name as Host).
// Plain tools (curl, the desktop shell) send neither Origin nor Sec-Fetch-Site
// and pass as long as they use a loopback host.
export interface RequestFacts {
  host: string | null;
  origin: string | null;
  secFetchSite: string | null;
}

export type OriginVerdict = { ok: true } | { ok: false; reason: string };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostnameOf(hostHeader: string): string {
  const trimmed = hostHeader.trim().toLowerCase();
  if (trimmed.startsWith("[")) return trimmed.slice(0, trimmed.indexOf("]") + 1);
  return trimmed.split(":")[0];
}

export function checkOrigin(facts: RequestFacts): OriginVerdict {
  const { host, origin, secFetchSite } = facts;
  if (!host || !LOOPBACK.has(hostnameOf(host))) {
    return { ok: false, reason: "Requests must be made to the local app address." };
  }
  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") {
    return { ok: false, reason: "Cross-site requests are not allowed." };
  }
  if (origin && origin !== "null") {
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return { ok: false, reason: "Malformed Origin header." };
    }
    if (originHost !== host.trim().toLowerCase()) {
      return { ok: false, reason: "Cross-origin requests are not allowed." };
    }
  } else if (origin === "null") {
    return { ok: false, reason: "Requests from opaque origins are not allowed." };
  }
  return { ok: true };
}

export function factsFromRequest(request: Request): RequestFacts {
  return {
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
  };
}
