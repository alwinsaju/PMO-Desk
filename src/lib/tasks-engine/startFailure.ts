// What to tell someone when the Tasks engine process dies before it answers. Pure:
// the start route passes in the numeric exit code and the tail of the launch log.
import { redact } from "../platform/redact.ts";

/** What Windows returns when "python" is only the Microsoft Store shortcut (or missing). */
export const PYTHON_NOT_FOUND_EXIT_CODE = 9009;

export interface EngineStartFailure {
  /** One plain sentence. */
  reason: string;
  /** What to try, in order. Only set for failures we recognise. */
  steps?: string[];
  /** The raw text, cleaned of secrets, for "Copy details". */
  detail?: string;
}

const PYTHON_STEPS = [
  "Install Python 3 from python.org, or ask your IT team to. Windows' built-in \"python\" shortcut (the Microsoft Store one) does not count.",
  "If you installed PMO Desk, reinstalling it restores the Python that comes with it.",
  "Running from a source checkout? Create tasks-engine/.venv as described in tasks-engine/README.md.",
  "Then press Retry. Nothing is installed for you.",
];

/** `logTail` is the launch log's tail, already prefixed (" Last output:\n..."), or "". */
export function explainEngineExit(exitCode: number, logTail: string): EngineStartFailure {
  const raw = `The engine process exited (code ${exitCode}) before it came up.${logTail}`;
  if (exitCode === PYTHON_NOT_FOUND_EXIT_CODE) {
    return {
      reason: "Python was not found on this computer, so the Tasks engine could not start.",
      steps: PYTHON_STEPS,
      detail: redact(raw).slice(0, 4000),
    };
  }
  return { reason: raw };
}
