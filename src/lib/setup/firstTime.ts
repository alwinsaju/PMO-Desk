// The marker the installer leaves on a FIRST install (build/installer.nsh): the
// first-time setup page opens once, before the home screen, then this is marked done.
// An update never writes it, so an existing user is not sent through setup again.
// Pure: the file text comes in and goes out.

export const FIRST_TIME_FILE = "first-time-setup.json";

export interface FirstTimeMarker {
  status: "pending" | "done";
  completedAt?: string;
}

/** The marker in a file's text; null when there is none or it is unreadable. */
export function parseFirstTime(text: string | null): FirstTimeMarker | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text.replace(/^\uFEFF/, "")) as {
      status?: unknown;
      completedAt?: unknown;
    };
    if (value.status !== "pending" && value.status !== "done") return null;
    return {
      status: value.status,
      ...(typeof value.completedAt === "string"
        ? { completedAt: value.completedAt }
        : {}),
    };
  } catch {
    return null;
  }
}

/** Whether the page should open now: the installer said pending, or a test forced it. */
export function firstTimePending(
  marker: FirstTimeMarker | null,
  forced: boolean,
): boolean {
  return forced || marker?.status === "pending";
}

export function doneMarker(now: Date): string {
  return JSON.stringify({ status: "done", completedAt: now.toISOString() });
}
