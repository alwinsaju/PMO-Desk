// The command bar's HTTP call to the AI routes, with Stop wired through an
// AbortSignal. Kept apart from CommandBar.tsx so the abort rules are testable.
import type { AiCommandResult } from "../../app/api/ai/command/types.ts";

export type CommandOutcome =
  { kind: "result"; result: AiCommandResult } | { kind: "stopped" };

export interface PostCommandOptions {
  /** Aborted when the person presses Stop. */
  signal: AbortSignal;
  /** A safety net for a request that hangs; not a Stop. */
  timeoutMs: number;
  /** Shown when the request fails for any reason other than Stop. */
  unreachableMessage: string;
  fetchImpl?: typeof fetch;
}

export async function postCommand(
  url: string,
  body: unknown,
  { signal, timeoutMs, unreachableMessage, fetchImpl = fetch }: PostCommandOptions,
): Promise<CommandOutcome> {
  if (signal.aborted) return { kind: "stopped" };
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    });
    return { kind: "result", result: (await res.json()) as AiCommandResult };
  } catch {
    if (signal.aborted) return { kind: "stopped" };
    return {
      kind: "result",
      result: { type: "error", kind: "unreachable", message: unreachableMessage },
    };
  }
}
