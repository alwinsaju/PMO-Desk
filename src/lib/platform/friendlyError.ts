// Plain-language errors: turn what went wrong (a failed request, a file problem, a stack
// trace) into one calm sentence plus a "copy details" text for support. Pure.
import { redact } from "./redact.ts";

export type ErrorKind =
  | "offline"
  | "timeout"
  | "refused"
  | "not-found"
  | "too-large"
  | "server"
  | "file-locked"
  | "file-missing"
  | "task"
  | "unknown";

export interface FriendlyError {
  kind: ErrorKind;
  /** One sentence a person can act on. */
  message: string;
  /** The raw text, cleaned of secrets, for "copy details". */
  detail: string;
}

const MESSAGES: Record<ErrorKind, string> = {
  offline:
    "AI OS could not reach its own server. Wait a moment and try again; if it keeps happening, restart AI OS.",
  timeout: "That took too long. Try again; if it keeps happening, restart AI OS.",
  refused: "AI OS refused that request for safety. Reload the window and try again.",
  "not-found":
    "That item is no longer there. It may have been moved or deleted; refresh and try again.",
  "too-large": "That is larger than AI OS allows. Try a smaller file or fewer items.",
  server:
    "Something went wrong on this computer. Try again; the details below help support find the cause.",
  "file-locked":
    "A file is open in another program (such as Excel or Outlook). Close it and try again.",
  "file-missing":
    "A file or folder AI OS needs could not be found. Check that it has not been moved.",
  task: "A task step failed. Open the run in Tasks > History for the reason in plain words.",
  unknown:
    "Something unexpected happened. Try again; the details below help support find the cause.",
};

function rawText(input: unknown): string {
  if (input instanceof Error) return `${input.name}: ${input.message}`;
  if (typeof input === "string") return input;
  if (typeof input === "object" && input !== null) {
    const o = input as Record<string, unknown>;
    if (typeof o.reason === "string") return o.reason;
    if (typeof o.message === "string") return o.message;
    try {
      return JSON.stringify(input);
    } catch {
      return String(input);
    }
  }
  return String(input ?? "");
}

function kindOf(text: string, status?: number): ErrorKind {
  const t = text.toLowerCase();
  if (status === 403) return "refused";
  if (status === 404) return "not-found";
  if (status === 413) return "too-large";
  if (status !== undefined && status >= 500) return "server";
  if (
    /traceback \(most recent call last\)|\bpython\b.*error|exit code \d+|step failed/.test(
      t,
    )
  )
    return "task";
  if (
    /ebusy|eperm|eacces|being used by another process|resource busy|permission denied/.test(
      t,
    )
  )
    return "file-locked";
  if (/enoent|no such file|cannot find (the )?(file|path)|not found on disk/.test(t))
    return "file-missing";
  if (/aborterror|timeouterror|timed out|timeout/.test(t)) return "timeout";
  if (
    /failed to fetch|networkerror|fetch failed|econnrefused|econnreset|load failed|network request failed/.test(
      t,
    )
  )
    return "offline";
  if (/refus|forbidden|not allowed|origin/.test(t)) return "refused";
  if (/too large|payload too large|exceeds|larger than/.test(t)) return "too-large";
  return "unknown";
}

/** A short text that already reads as a sentence (no stack, no code) is kept as written. */
const looksPlain = (text: string): boolean =>
  text.length > 0 &&
  text.length <= 160 &&
  !/\n|\bat .+\(.+:\d+:\d+\)|Error:|Exception|0x[0-9a-f]{4,}/i.test(text) &&
  /[a-z]/i.test(text);

export function explainError(
  input: unknown,
  options: { status?: number } = {},
): FriendlyError {
  const text = rawText(input).trim();
  const kind = kindOf(text, options.status);
  const message =
    kind === "unknown" && looksPlain(text)
      ? /[.!?]$/.test(text)
        ? text
        : `${text}.`
      : MESSAGES[kind];
  return { kind, message, detail: redact(text).slice(0, 4000) };
}

/** What "Copy details" puts on the clipboard. */
export function detailsText(
  error: FriendlyError,
  context: { appVersion?: string; where?: string; now?: Date } = {},
): string {
  return [
    `AI OS ${context.appVersion ?? "unknown version"}`,
    `When: ${(context.now ?? new Date()).toISOString()}`,
    context.where ? `Where: ${context.where}` : "",
    `What: ${error.message}`,
    `Details: ${error.detail || "(none)"}`,
  ]
    .filter(Boolean)
    .join("\n");
}
