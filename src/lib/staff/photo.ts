// Profile pictures: format sniffing and base64 decoding. The bytes are never
// trusted by name or by the caller's content type, only by their first bytes.
export const MAX_PHOTO_BYTES = 1024 * 1024;

export type PhotoType = "image/jpeg" | "image/png" | "image/webp";

export function sniffPhotoType(bytes: Uint8Array): PhotoType | null {
  const startsWith = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** Accepts plain base64 or a data URL; null when it is not valid base64. */
export function decodeBase64Photo(input: string): Uint8Array | null {
  const body = input.replace(/^data:[^;,]+;base64,/, "").replace(/\s+/g, "");
  if (!body || body.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body)) return null;
  return new Uint8Array(Buffer.from(body, "base64"));
}

/** The photo's type when the bytes are acceptable, otherwise the reason to refuse them. */
export function checkPhoto(bytes: Uint8Array): { type: PhotoType } | { error: string } {
  if (bytes.byteLength === 0) return { error: "The photo is empty." };
  if (bytes.byteLength > MAX_PHOTO_BYTES)
    return { error: "The photo is larger than 1 MB." };
  const type = sniffPhotoType(bytes);
  return type ? { type } : { error: "The photo must be a JPEG, PNG or WebP image." };
}
