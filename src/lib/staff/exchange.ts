// The folder hand-over with the M365 profile flow (Power Automate). Pure parts:
// file names and the shape of a profile file. The folder work is in
// exchangeServer.ts.
import { isValidEmail } from "./employees.ts";
import type { ProfilePayload } from "./types.ts";

/** The app writes `<email>~<stamp>.json` here for each person waiting for a profile. */
export const REQUESTS_DIR = "requests";
/** The flow writes `<email>.json` here; the app applies and removes each file. */
export const PROFILES_DIR = "profiles";
/** Profile files the app could not use, with a `.reason.txt` beside each. */
export const REJECTED_DIR = "rejected";

/** Largest profile file read (a picture is most of it). */
export const MAX_PROFILE_FILE_BYTES = 3 * 1024 * 1024;
/** A file that does not parse yet may still be syncing; younger than this, leave it. */
export const PARTIAL_FILE_GRACE_MS = 2 * 60 * 1000;

const SAFE_FILE_EMAIL = /^[a-z0-9._%+'@-]+$/;

/** Separates the e-mail from a time stamp in a request file name. A flow takes
 *  everything before it as the address; `~` cannot occur in an address we accept. */
export const REQUEST_SEPARATOR = "~";

/** The address a request file is for, from its name (or null). */
export function emailFromRequestFile(fileName: string): string | null {
  if (!fileName.endsWith(".json")) return null;
  const [email] = fileName.slice(0, -".json".length).split(REQUEST_SEPARATOR);
  return email || null;
}

/** `jane.doe@x.com` + `m1abc` -> `jane.doe@x.com~m1abc.json`; null when the
 *  address cannot be used in a file name. */
export function requestFileName(email: string, stamp: string): string | null {
  const clean = email.trim().toLowerCase();
  if (!isValidEmail(clean) || clean.length > 150 || !SAFE_FILE_EMAIL.test(clean))
    return null;
  return `${clean}${REQUEST_SEPARATOR}${stamp}.json`;
}

const PROFILE_TEXT_KEYS = [
  "email",
  "firstName",
  "lastName",
  "homeOffice",
  "level",
  "op",
  "phone",
] as const;

/** Flows can hand a picture over as plain base64, a data URL, or the
 *  `{ "$content-type", "$content" }` object a connector returns for a file. */
function photoText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const inner = (value as Record<string, unknown>)["$content"];
    if (typeof inner === "string") return inner.trim();
  }
  return "";
}

const FLOW_TEXT_HINT =
  "The flow wrote its expressions as plain text instead of values (the file contains text like @outputs(...)). " +
  "Check the Profile step of the flow against docs/staff-m365-flow.md (paste only the JSON, without the word json before it).";

/** True when a flow step stored an expression as text rather than evaluating it. */
function hasUnevaluatedExpression(text: string): boolean {
  return /@(?:outputs|body|triggerOutputs|variables|items|actions)\(/.test(text);
}

export type ParsedProfile =
  { ok: true; profile: ProfilePayload } | { ok: false; reason: string };

/** Reads one profile file. Empty, null and missing values are dropped, so a
 *  flow that has nothing for a field can simply send null. */
export function parseProfileFile(text: string): ParsedProfile {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return {
      ok: false,
      reason: hasUnevaluatedExpression(text)
        ? FLOW_TEXT_HINT
        : "The file is not valid JSON.",
    };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "The file must hold one JSON object." };
  }
  const source = raw as Record<string, unknown>;
  const profile: Record<string, string> = {};
  for (const key of PROFILE_TEXT_KEYS) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) profile[key] = value.trim();
  }
  const photo = photoText(source.photoBase64);
  if (photo) profile.photoBase64 = photo;
  if (!profile.email) return { ok: false, reason: "The file has no email." };
  if (hasUnevaluatedExpression(profile.email))
    return { ok: false, reason: FLOW_TEXT_HINT };
  return { ok: true, profile: profile as unknown as ProfilePayload };
}
