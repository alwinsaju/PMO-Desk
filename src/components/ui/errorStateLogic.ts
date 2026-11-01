// Clipboard text for ErrorState's "Copy details" (see errorStateLogic.test.mjs);
// shares the support-text layout used by the platform's CopyDetailsButton.
import { detailsText } from "../../lib/platform/friendlyError.ts";

export interface ErrorStateInfo {
  /** What failed, in plain words. */
  title: string;
  /** The likely cause, in plain words. */
  cause?: string;
  /** Technical line for support (already cleaned with `explainError`). */
  detail?: string;
  /** Which screen or app it happened in. */
  where?: string;
}

export function errorStateDetails(
  { title, cause, detail, where }: ErrorStateInfo,
  context: { appVersion?: string; now?: Date } = {},
): string {
  const lines = [cause ? `Likely cause: ${cause}` : "", detail ?? ""].filter(Boolean);
  return detailsText(
    { kind: "unknown", message: title, detail: lines.join("\n") },
    { ...context, where },
  );
}
