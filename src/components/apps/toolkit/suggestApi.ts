// Client for POST /api/registers/suggest (same origin, the local model only). A failure is a
// value with a plain reason, never a throw, so the form keeps working without the model.
import type { FieldValue } from "@/lib/registers/types";

export type SuggestReply =
  | { ok: true; field: string; value: string; dropped?: number }
  | { ok: false; reason: string; cancelled?: boolean };

/** The model may have to wake first (1-2 minutes on this PC), so this waits longer than the
 *  server's own limit and lets that one speak first. */
const WAIT_MS = 170_000;

export async function requestSuggestion(
  tool: string,
  values: Record<string, FieldValue>,
  signal: AbortSignal,
): Promise<SuggestReply> {
  const timer = new AbortController();
  const stop = setTimeout(() => timer.abort(), WAIT_MS);
  const onAbort = () => timer.abort();
  signal.addEventListener("abort", onAbort);
  try {
    const res = await fetch("/api/registers/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: timer.signal,
      body: JSON.stringify({ tool, values }),
    });
    const body = (await res.json().catch(() => null)) as SuggestReply | null;
    if (body && body.ok === true && typeof body.value === "string") return body;
    if (body && body.ok === false && typeof body.reason === "string") return body;
    return {
      ok: false,
      reason: "The suggestion service did not answer. Fill this in by hand.",
    };
  } catch {
    if (signal.aborted) return { ok: false, reason: "Cancelled.", cancelled: true };
    return {
      ok: false,
      reason: timer.signal.aborted
        ? "The local model took too long. Try again, or fill this in by hand."
        : "Could not reach the local AI. You can still fill this in by hand.",
    };
  } finally {
    clearTimeout(stop);
    signal.removeEventListener("abort", onAbort);
  }
}
