// Reading a request body without ever holding more than `maxBytes` of it.
// `request.text()` / `request.json()` buffer the whole body first, so a client
// that omits Content-Length (chunked) could push an arbitrary amount into memory
// before any size check ran. These helpers read the stream and stop at the cap.

export class BodyTooLargeError extends Error {
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(`The request body is larger than ${maxBytes} bytes.`);
    this.name = "BodyTooLargeError";
    this.maxBytes = maxBytes;
  }
}

function declaredLength(request: Request): number {
  const header = request.headers.get("content-length");
  return header === null ? NaN : Number(header);
}

/** The body as bytes; throws BodyTooLargeError as soon as the cap is exceeded
 *  (by the declared Content-Length, or by the bytes actually received). */
export async function readBytesBounded(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = declaredLength(request);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BodyTooLargeError(maxBytes);
  }
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BodyTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** The body as UTF-8 text, under the same cap. */
export async function readTextBounded(
  request: Request,
  maxBytes: number,
): Promise<string> {
  return new TextDecoder().decode(await readBytesBounded(request, maxBytes));
}
