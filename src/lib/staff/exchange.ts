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

/** The M365 flow looks each person up through a connector that answers HTTP 429 when many
 *  lookups arrive together (the Staff import of 70+ people hit it after about 50). So the app
 *  does not drop every request at once, and it asks again, later and later, for a request
 *  that was never answered. */
export const MAX_NEW_REQUESTS_PER_SCAN = 5;
/** Requests written and not yet answered or due for a retry, at most. */
export const MAX_REQUESTS_IN_FLIGHT = 10;
/** First wait for an answer; doubles with every unanswered try. */
export const RETRY_BASE_MS = 4 * 60 * 1000;
export const RETRY_MAX_MS = 60 * 60 * 1000;
/** After this many tries the app stops asking by itself ("Request again" still works). */
export const MAX_AUTO_ATTEMPTS = 8;

/** How long try number `attempt` (1 = the first) waits for an answer before the next one. */
export function retryDelayMs(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(RETRY_BASE_MS * 2 ** (n - 1), RETRY_MAX_MS);
}

/** A request file already in the folder. */
export interface OpenRequest {
  email: string;
  /** Which try wrote it (1 = the first). */
  attempt: number;
  ageMs: number;
}

export interface PlannedRequest {
  email: string;
  attempt: number;
}

/**
 * Which requests to write now. People nobody has asked for come first (one by one, a few per
 * scan), then requests whose wait is over, longest-waiting first, each as the next try. The
 * total in flight stays under MAX_REQUESTS_IN_FLIGHT so the flow is never flooded.
 */
export function planRequests(input: {
  waiting: readonly string[];
  open: readonly OpenRequest[];
}): PlannedRequest[] {
  const waiting = new Map(input.waiting.map((e) => [e.toLowerCase(), e]));
  const byEmail = new Map<string, OpenRequest>();
  for (const request of input.open) {
    const key = request.email.toLowerCase();
    if (waiting.has(key) && !byEmail.has(key)) byEmail.set(key, request);
  }
  const due: OpenRequest[] = [];
  let inFlight = 0;
  for (const request of byEmail.values()) {
    if (request.ageMs >= retryDelayMs(request.attempt)) {
      if (request.attempt < MAX_AUTO_ATTEMPTS) due.push(request);
    } else {
      inFlight++;
    }
  }
  const room = Math.min(MAX_NEW_REQUESTS_PER_SCAN, MAX_REQUESTS_IN_FLIGHT - inFlight);
  if (room <= 0) return [];
  const fresh: PlannedRequest[] = [...waiting]
    .filter(([key]) => !byEmail.has(key))
    .map(([, email]) => ({ email, attempt: 1 }));
  const retries: PlannedRequest[] = due
    .sort((a, b) => b.ageMs - a.ageMs)
    .map((r) => ({ email: r.email, attempt: r.attempt + 1 }));
  return [...fresh, ...retries].slice(0, room);
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

/** Other names a flow may use for the offering portfolio (the M365 department).
 *  `offering` is what the first version of the flow guide called it. */
const OP_ALIASES = ["department", "offeringPortfolio", "offering"] as const;

/** The home office is the city Teams shows (Bengaluru), not the state (Karnataka): a
 *  `city` in the file wins over a `homeOffice` the first flow guide filled with the state. */
const HOME_OFFICE_KEYS = ["city", "homeOffice", "officeLocation"] as const;

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
  for (const alias of OP_ALIASES) {
    const value = source[alias];
    if (!profile.op && typeof value === "string" && value.trim()) {
      profile.op = value.trim();
    }
  }
  const office = HOME_OFFICE_KEYS.map((key) => source[key]).find(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
  if (office) profile.homeOffice = office.trim();
  const photo = photoText(source.photoBase64);
  if (photo) profile.photoBase64 = photo;
  if (!profile.email) return { ok: false, reason: "The file has no email." };
  if (hasUnevaluatedExpression(profile.email))
    return { ok: false, reason: FLOW_TEXT_HINT };
  return { ok: true, profile: profile as unknown as ProfilePayload };
}
