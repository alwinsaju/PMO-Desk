// Decision logic of src/middleware.ts, kept free of Next so `pnpm test` can run it.
// Every /api request must be addressed to a loopback host (DNS rebinding), and a
// request that can change something must not come from another origin.
import {
  checkOrigin,
  factsFromRequest,
  type OriginVerdict,
} from "../pmo/server/originCheck.ts";

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** `checkReads` applies the Origin / Sec-Fetch-Site rule to reads too (for routes
 *  that act on the caller's behalf, e.g. fetch a URL they name). */
export function guardApiRequest(
  request: Request,
  { checkReads = false }: { checkReads?: boolean } = {},
): OriginVerdict {
  const facts = factsFromRequest(request);
  if (!checkReads && READ_ONLY_METHODS.has(request.method.toUpperCase())) {
    // Reads only need the Host check; same-origin reads carry no Origin anyway.
    return checkOrigin({ host: facts.host, origin: null, secFetchSite: null });
  }
  return checkOrigin(facts);
}
