// Reading a request body with a size cap. Kept apart from http.ts (which
// imports next/server) so `pnpm test` can load it under plain Node.

/** Like readBody, but refuses a request bigger than `maxBytes` before parsing
 *  it (the Content-Length is checked first, then the real size, since a client
 *  may omit or lie about the header). `reason` says why when there is no body. */
export async function readBodyCapped(
  request: Request,
  maxBytes: number,
): Promise<{ body: unknown } | { reason: string }> {
  const tooBig = {
    reason: `That is too large (the limit is ${Math.round(maxBytes / 1024)} KB).`,
  };
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return tooBig;
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { reason: "Could not read the request." };
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes) return tooBig;
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { reason: "The request was not valid JSON." };
  }
}
