"use client";

import { usePlatformPrefs } from "@/lib/platform/platformPrefsStore";
import { checkForUpdate } from "./platformApi";

export type UpdateOutcome =
  | { ok: true; available: false }
  | { ok: true; available: true; version: string; notes: string[] }
  | { ok: false; reason: string; detail?: string };

/** Look for a newer release at the saved address and remember the result. Used by the button and the daily check. */
export async function runUpdateCheck(): Promise<UpdateOutcome> {
  const prefs = usePlatformPrefs.getState();
  const reply = await checkForUpdate(prefs.updates.manifestUrl);
  const now = new Date().toISOString();
  if (!reply.ok) {
    prefs.update((p) => ({ ...p, updates: { ...p.updates, lastCheckedAt: now } }));
    return { ok: false, reason: reply.reason, detail: reply.detail };
  }
  prefs.update((p) => ({
    ...p,
    updates: {
      ...p.updates,
      lastCheckedAt: now,
      availableVersion: reply.available ? reply.manifest.version : "",
    },
  }));
  return reply.available
    ? {
        ok: true,
        available: true,
        version: reply.manifest.version,
        notes: reply.manifest.notes,
      }
    : { ok: true, available: false };
}
