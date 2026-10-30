// Opt-in update check (off by default). The person gives an address that serves a
// small JSON "latest release" file; this module validates it and downloads the
// installer it names, checking its SHA-256 before anything can be run. Nothing is
// installed here: the person starts the installer themselves. Server only.
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isPrivateAddress, parseCheckableUrl } from "../browser/embeddableCheck.ts";
import { parseVersion } from "./version.ts";

export { compareVersions, isNewer, parseVersion } from "./version.ts";
export { CHECK_INTERVAL_MS, checkDue } from "./updateCheck.ts";

export const MAX_MANIFEST_BYTES = 64 * 1024;
export const MAX_INSTALLER_BYTES = 600 * 1024 * 1024;

export interface UpdateManifest {
  version: string;
  notes: string[];
  url: string;
  sha256: string;
  publishedAt: string;
}

export type Resolver = (host: string) => Promise<string[]>;
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface UpdateDeps {
  fetchImpl?: Fetcher;
  resolve?: Resolver;
}

export type ManifestResult =
  { ok: true; manifest: UpdateManifest } | { ok: false; reason: string };

const text = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/** The manifest, or the plain reason it is not acceptable. The installer must be https on the same site. */
export function parseManifest(raw: unknown, manifestUrl: string): ManifestResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reason: "The update file is not in the expected format." };
  }
  const r = raw as Record<string, unknown>;
  const version = text(r.version, 32);
  if (!parseVersion(version)) {
    return { ok: false, reason: "The update file has no valid version number." };
  }
  const sha256 = text(r.sha256, 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    return {
      ok: false,
      reason: "The update file has no SHA-256 checksum, so it is not trusted.",
    };
  }
  let installer: URL;
  let source: URL;
  try {
    installer = new URL(text(r.url, 500), manifestUrl);
    source = new URL(manifestUrl);
  } catch {
    return { ok: false, reason: "The update file has no valid download address." };
  }
  if (installer.protocol !== "https:" || installer.host !== source.host) {
    return {
      ok: false,
      reason:
        "The installer must be served over https from the same site as the update file.",
    };
  }
  if (!/\.exe$/i.test(installer.pathname)) {
    return { ok: false, reason: "The download is not an installer (.exe)." };
  }
  const notes = Array.isArray(r.notes)
    ? r.notes
        .map((n) => text(n, 200))
        .filter(Boolean)
        .slice(0, 12)
    : [];
  return {
    ok: true,
    manifest: {
      version,
      notes,
      url: installer.toString(),
      sha256,
      publishedAt: text(r.publishedAt, 40),
    },
  };
}

const defaultResolve: Resolver = async (host) =>
  (await lookup(host, { all: true })).map((a) => a.address);

/** Why an address may not be contacted (not https, local, private), or null. */
export async function addressProblem(
  value: string,
  resolve: Resolver = defaultResolve,
): Promise<string | null> {
  const url = parseCheckableUrl(value);
  if (!url || url.protocol !== "https:") {
    return "Use an https address for a site on the internet.";
  }
  try {
    const answers = await resolve(url.hostname);
    if (answers.length === 0 || answers.some(isPrivateAddress)) {
      return "That address points to a private network, so it is not used.";
    }
  } catch {
    return "That address could not be found.";
  }
  return null;
}

async function readCapped(response: Response, max: number): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Fetch and validate the update file at `url`. Never throws. */
export async function fetchManifest(
  url: string,
  deps: UpdateDeps = {},
): Promise<ManifestResult> {
  const problem = await addressProblem(url, deps.resolve);
  if (problem) return { ok: false, reason: problem };
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(url, {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return {
        ok: false,
        reason: `The update site answered with an error (${response.status}).`,
      };
    }
    const body = await readCapped(response, MAX_MANIFEST_BYTES);
    if (body === null) return { ok: false, reason: "The update file is too large." };
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      return { ok: false, reason: "The update file is not valid JSON." };
    }
    return parseManifest(json, url);
  } catch {
    return {
      ok: false,
      reason: "Could not reach the update site. Check your connection.",
    };
  }
}

export interface DownloadResult {
  ok: boolean;
  reason?: string;
  file?: string;
}

/** Installer file name from a version, safe on Windows. */
export const installerName = (version: string): string =>
  `AI-OS-Setup-${version.replace(/[^0-9A-Za-z.-]/g, "_")}.exe`;

/** Download the installer into `dir`, verify its SHA-256 and only then give it its final name. */
export async function downloadInstaller(
  manifest: UpdateManifest,
  dir: string,
  deps: UpdateDeps = {},
): Promise<DownloadResult> {
  const problem = await addressProblem(manifest.url, deps.resolve);
  if (problem) return { ok: false, reason: problem };
  const fetchImpl = deps.fetchImpl ?? fetch;
  const finalPath = path.join(dir, installerName(manifest.version));
  const partial = `${finalPath}.part`;
  try {
    const response = await fetchImpl(manifest.url, {
      redirect: "error",
      signal: AbortSignal.timeout(15 * 60_000),
    });
    if (!response.ok || !response.body) {
      return { ok: false, reason: `The download failed (${response.status}).` };
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_INSTALLER_BYTES) {
      return {
        ok: false,
        reason: "The installer is larger than expected, so it was not downloaded.",
      };
    }
    await mkdir(dir, { recursive: true });
    const hash = createHash("sha256");
    let total = 0;
    const source = Readable.fromWeb(response.body as never);
    source.on("data", (chunk: Buffer) => {
      total += chunk.length;
      hash.update(chunk);
      if (total > MAX_INSTALLER_BYTES) source.destroy(new Error("too large"));
    });
    await pipeline(source, createWriteStream(partial));
    if (hash.digest("hex") !== manifest.sha256) {
      await unlink(partial).catch(() => undefined);
      return {
        ok: false,
        reason: "The downloaded file does not match its checksum, so it was deleted.",
      };
    }
    await rename(partial, finalPath);
    return { ok: true, file: finalPath };
  } catch {
    await unlink(partial).catch(() => undefined);
    return { ok: false, reason: "The download could not be completed." };
  }
}
