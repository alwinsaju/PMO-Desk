// What the Dashboard's PNG / PDF buttons tell the user once the export finishes. Pure.

export type ExportOutcome =
  { status: "saved"; path: string } | { status: "cancelled" } | { status: "failed" };

/** The shell answers null both when the person cancels the Save dialog and when nothing could be
 *  captured or written; `captured` tells them apart (the picture was taken but not saved = cancelled). */
export function exportOutcome(captured: boolean, saved: string | null): ExportOutcome {
  if (saved) return { status: "saved", path: saved };
  return captured ? { status: "cancelled" } : { status: "failed" };
}

/** The toast for an outcome, or null when nothing should be said (cancelling is not an error). */
export function exportToast(
  outcome: ExportOutcome,
  format: "png" | "pdf",
): { tone: "success" | "danger"; message: string } | null {
  if (outcome.status === "saved") {
    return { tone: "success", message: `Saved ${outcome.path}` };
  }
  if (outcome.status === "cancelled") return null;
  return {
    tone: "danger",
    message: `Could not save the Dashboard as ${format === "png" ? "a picture" : "a PDF"}. Try again.`,
  };
}
