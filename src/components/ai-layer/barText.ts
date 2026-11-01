import type { AgentTaskStatus } from "./types";

/** "0:07", "2:35": how long the model has been waking. */
export function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(
    0,
    Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0),
  );
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The heading of an answer card: what was asked, short ("What is overdue?"), or "Answer". */
export function answerTitle(prompt: string, max = 60): string {
  const text = prompt.replace(/\s+/g, " ").trim();
  if (!text) return "Answer";
  const first = text.charAt(0).toUpperCase() + text.slice(1);
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

/**
 * The command bar's placeholder. While the local model is asleep the first answer has
 * to load it, which takes minutes on a CPU-only computer, so say so (with a running
 * clock) instead of a bare "Thinking…" that looks stuck.
 */
export function placeholderFor(
  status: AgentTaskStatus | null,
  wake: { waking: boolean; elapsedSeconds: number; thinkingSeconds?: number } = {
    waking: false,
    elapsedSeconds: 0,
  },
): string {
  switch (status) {
    case "thinking":
      if (wake.waking) {
        return `Waking the AI model… ${formatElapsed(wake.elapsedSeconds)}`;
      }
      return wake.thinkingSeconds === undefined
        ? "Thinking…"
        : `Thinking… ${formatElapsed(wake.thinkingSeconds)}`;
    case "working":
      return "Working…";
    case "completed":
      return "Done…";
    case null:
      return "Ask AI to do something…";
  }
}
