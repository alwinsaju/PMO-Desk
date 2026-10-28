// When Setup does background work. The launch check is passive (nothing slow,
// nothing started); opening Setup looks properly once; while Setup stays open
// (or the Tasks app asks) the slow Outlook probe repeats only when it is old.
// Pure: the clock is passed in.

/** launch = the check at app start; open = Setup was just opened or "Check again";
 *  refresh = a later poll while Setup (or the Tasks app) is open. */
export type StatusContext = "launch" | "open" | "refresh";

export const OUTLOOK_REPROBE_MS = 30 * 60_000;
export const OLLAMA_START_RETRY_MS = 60_000;

export function parseStatusContext(raw: {
  fresh: string | null;
  launch: string | null;
}): StatusContext {
  if (raw.launch === "1") return "launch";
  return raw.fresh === "1" ? "open" : "refresh";
}

export function outlookProbeDue(input: {
  context: StatusContext;
  cachedAt: number | undefined;
  now: number;
}): boolean {
  const { context, cachedAt, now } = input;
  if (context === "launch") return false;
  if (context === "open") return true;
  return cachedAt === undefined || now - cachedAt >= OUTLOOK_REPROBE_MS;
}

/** Start Ollama for the Setup model check: never at launch, and not again within a minute of a try. */
export function ollamaStartDue(input: {
  context: StatusContext;
  exeFound: boolean;
  running: boolean;
  lastAttemptAt: number | undefined;
  now: number;
}): boolean {
  const { context, exeFound, running, lastAttemptAt, now } = input;
  if (context === "launch" || running || !exeFound) return false;
  return lastAttemptAt === undefined || now - lastAttemptAt >= OLLAMA_START_RETRY_MS;
}
