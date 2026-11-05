"use client";

import { fetchSummaries } from "@/components/apps/toolkit/registersApi";
import { useRegisterSummaries } from "@/components/apps/toolkit/summariesStore";
import { useDockBadgeStore } from "@/components/taskbar/dockBadgeStore";
import { useNeedsYou } from "./needsYouStore";

/** Reads how many items in the PMO tools are late and publishes it to the PMO Toolkit's dock badge and the
 *  "needs you" total. Shared by the minute-by-minute watcher and the Dashboard's Refresh button, so a
 *  refresh brings the dock badge up to date at once. Resolves to false when the server could not be read. */
export async function refreshRegisterSummaries(): Promise<boolean> {
  const reply = await fetchSummaries();
  if (!reply.ok) return false;
  useRegisterSummaries.getState().set(reply.summaries);
  const late = reply.summaries.reduce((n, s) => n + s.late, 0);
  useNeedsYou.getState().setRegisters(late);
  useDockBadgeStore.getState().setBadge("pmo-toolkit", late);
  return true;
}
