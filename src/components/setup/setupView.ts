// What the setup screen says and when it opens: pure helpers, covered by tests.
import { MODEL_SIZE, formatBytes } from "../../lib/format.ts";
import {
  missingRequired,
  type CheckState,
  type SetupReport,
} from "../../lib/setup/report.ts";

export const SKIP_STORAGE_KEY = "ai-os:setup-skipped";

export function stateLabel(state: CheckState): string {
  switch (state) {
    case "ok":
      return "Ready";
    case "attention":
      return "Check this";
    case "missing":
      return "Needs action";
    default:
      return "Not checked";
  }
}

export type StateTone = "success" | "warning" | "danger" | "neutral";

export function stateTone(state: CheckState): StateTone {
  switch (state) {
    case "ok":
      return "success";
    case "attention":
      return "warning";
    case "missing":
      return "danger";
    default:
      return "neutral";
  }
}

/** "about 3 minutes left", "less than a minute left"; null when unknown. */
export function formatEta(seconds: number | null | undefined): string | null {
  if (
    seconds === null ||
    seconds === undefined ||
    !Number.isFinite(seconds) ||
    seconds < 0
  )
    return null;
  if (seconds < 60) return "less than a minute left";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `about ${minutes} minute${minutes === 1 ? "" : "s"} left`;
  const hours = Math.round((seconds / 3600) * 10) / 10;
  return `about ${hours} hours left`;
}

export function formatRate(bytesPerSecond: number | null | undefined): string | null {
  if (!bytesPerSecond || bytesPerSecond <= 0) return null;
  return `${formatBytes(bytesPerSecond, MODEL_SIZE)}/s`;
}

/** "3.2 GB of 12 GB · 18 MB/s · about 8 minutes left" */
export function pullDetail(progress: {
  completedBytes: number;
  totalBytes: number;
  bytesPerSecond: number | null;
  etaSeconds: number | null;
}): string {
  const parts = [
    progress.totalBytes > 0
      ? `${formatBytes(progress.completedBytes, MODEL_SIZE)} of ${formatBytes(progress.totalBytes, MODEL_SIZE)}`
      : null,
    formatRate(progress.bytesPerSecond),
    formatEta(progress.etaSeconds),
  ];
  return parts.filter(Boolean).join(" · ");
}

/** The list of required things that are still open, as one comparable string. */
export function skipSignature(report: SetupReport): string {
  return missingRequired(report).join(",");
}

/**
 * Open the screen at launch only when something required is still open AND the
 * person has not already chosen "Not now" for exactly this list. If the list
 * changes (something new breaks, or one thing gets fixed and another remains)
 * it asks again.
 */
export function shouldAutoOpen(
  report: SetupReport,
  skippedSignature: string | null,
): boolean {
  if (report.ready) return false;
  const signature = skipSignature(report);
  return signature !== "" && signature !== skippedSignature;
}
