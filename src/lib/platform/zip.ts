// A small zip writer and reader for backups, diagnostics and exports. Server only
// (it uses node:zlib). It reads only what it understands: no encryption, no zip64,
// stored or deflated entries; anything else is refused with a plain reason.
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

export interface ZipEntry {
  /** Forward-slash path inside the archive. */
  name: string;
  data: Uint8Array;
}

export interface ZipLimits {
  maxEntries: number;
  /** Total bytes after unpacking. */
  maxTotalBytes: number;
  maxEntryBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 50_000,
  maxTotalBytes: 2 * 1024 ** 3,
  maxEntryBytes: 512 * 1024 ** 2,
};

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

export class ZipError extends Error {}

/** Why an entry name is unsafe to extract, or null. Blocks "zip slip" and drive paths. */
export function unsafeEntryName(name: string): string | null {
  if (!name) return "an entry has no name";
  if (name.length > 400) return `the entry name "${name.slice(0, 40)}…" is too long`;
  if (/[\u0000-\u001f]/.test(name)) return "an entry name has control characters";
  if (name.includes("\\")) return `the entry name "${name}" uses a backslash`;
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
    return `the entry name "${name}" is an absolute path`;
  }
  if (name.split("/").some((part) => part === ".." || part === ".")) {
    return `the entry name "${name}" climbs out of the folder`;
  }
  return null;
}

export function writeZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const seen = new Set<string>();
  for (const entry of entries) {
    const bad = unsafeEntryName(entry.name);
    if (bad) throw new ZipError(bad);
    if (seen.has(entry.name)) throw new ZipError(`"${entry.name}" is listed twice`);
    seen.add(entry.name);
    const raw = Buffer.from(entry.data);
    const packed = deflateRawSync(raw);
    const useDeflate = packed.length < raw.length;
    const body = useDeflate ? packed : raw;
    const method = useDeflate ? 8 : 0;
    const name = Buffer.from(entry.name, "utf8");
    const sum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_END, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

function findEnd(buf: Buffer): number {
  const lowest = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= lowest; i--) {
    if (buf.readUInt32LE(i) === SIG_END) return i;
  }
  throw new ZipError("This is not a zip file.");
}

/** Unpack every entry, verifying names, sizes and checksums. Throws ZipError with a reason a person can read. */
export function readZip(
  input: Uint8Array,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): ZipEntry[] {
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (buf.length < 22) throw new ZipError("This is not a zip file.");
  const end = findEnd(buf);
  const count = buf.readUInt16LE(end + 10);
  let pos = buf.readUInt32LE(end + 16);
  if (count === 0xffff || pos === 0xffffffff) {
    throw new ZipError("Zip64 archives are not supported.");
  }
  if (count > limits.maxEntries) {
    throw new ZipError(
      `The archive has ${count} files; the limit is ${limits.maxEntries}.`,
    );
  }
  const out: ZipEntry[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== SIG_CENTRAL) {
      throw new ZipError("The archive's file list is damaged.");
    }
    const flags = buf.readUInt16LE(pos + 8);
    const method = buf.readUInt16LE(pos + 10);
    const sum = buf.readUInt32LE(pos + 16);
    const packedSize = buf.readUInt32LE(pos + 20);
    const size = buf.readUInt32LE(pos + 24);
    const nameLength = buf.readUInt16LE(pos + 28);
    const extraLength = buf.readUInt16LE(pos + 30);
    const commentLength = buf.readUInt16LE(pos + 32);
    const localAt = buf.readUInt32LE(pos + 42);
    const name = buf.toString("utf8", pos + 46, pos + 46 + nameLength);
    pos += 46 + nameLength + extraLength + commentLength;

    if (flags & 1) throw new ZipError("Encrypted archives are not supported.");
    if (name.endsWith("/")) continue; // folder entry
    const bad = unsafeEntryName(name);
    if (bad) throw new ZipError(`Refused: ${bad}.`);
    if (seen.has(name)) throw new ZipError(`Refused: "${name}" appears twice.`);
    seen.add(name);
    if (size > limits.maxEntryBytes) {
      throw new ZipError(
        `"${name}" is larger than the ${limits.maxEntryBytes} byte limit.`,
      );
    }
    total += size;
    if (total > limits.maxTotalBytes) {
      throw new ZipError("The archive unpacks to more than the allowed size.");
    }
    if (localAt + 30 > buf.length || buf.readUInt32LE(localAt) !== SIG_LOCAL) {
      throw new ZipError(`"${name}" cannot be found in the archive.`);
    }
    const start =
      localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
    if (start + packedSize > buf.length) {
      throw new ZipError(`"${name}" runs past the end of the archive.`);
    }
    const body = buf.subarray(start, start + packedSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(body);
    else if (method === 8) {
      try {
        data = inflateRawSync(body, { maxOutputLength: size + 1 });
      } catch {
        throw new ZipError(`"${name}" is damaged.`);
      }
    } else throw new ZipError(`"${name}" uses an unsupported compression method.`);
    if (data.length !== size || crc32(data) !== sum) {
      throw new ZipError(`"${name}" failed its checksum, so the archive is damaged.`);
    }
    out.push({ name, data });
  }
  return out;
}
