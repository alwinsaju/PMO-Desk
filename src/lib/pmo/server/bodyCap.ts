// Reading a request body with a size cap. Kept apart from http.ts (which
// imports next/server) so `pnpm test` can load it under plain Node.
import { BodyTooLargeError, readTextBounded } from "../../security/boundedBody.ts";

/** Default cap for the small JSON bodies of the /api/pmo routes. */
export const DEFAULT_BODY_BYTES = 1024 * 1024;

/** Like readBody, but refuses a request bigger than `maxBytes` before parsing
 *  it (the Content-Length is checked first, then the bytes actually received,
 *  since a client may omit or lie about the header). `reason` says why when
 *  there is no body. */
export async function readBodyCapped(
  request: Request,
  maxBytes: number,
): Promise<{ body: unknown } | { reason: string }> {
  let text: string;
  try {
    text = await readTextBounded(request, maxBytes);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return {
        reason: `That is too large (the limit is ${Math.round(maxBytes / 1024)} KB).`,
      };
    }
    return { reason: "Could not read the request." };
  }
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { reason: "The request was not valid JSON." };
  }
}
