"use client";

import { useDockBadgeStore } from "@/components/taskbar/dockBadgeStore";
import { useNeedsYou } from "@/lib/dashboard/needsYouStore";
import { summarise } from "@/lib/registers/alerts";
import { registerById } from "@/lib/registers/defs";
import type { RegisterFile } from "@/lib/registers/types";
import { todayIso } from "@/lib/staff/dates";
import { useRegisterSummaries } from "./summariesStore";

/** After a save in an open tool: update that tool's counts and the dock and needs-you totals at once,
 *  instead of waiting for the next minute's read. Does nothing until the first read has filled the totals. */
export function publishSummary(id: string, file: RegisterFile): void {
  const def = registerById(id);
  const store = useRegisterSummaries.getState();
  if (!def || !store.loaded) return;
  const summary = summarise(def, file.items, { today: todayIso(), config: file.config });
  store.setOne(file.invalid ? { ...summary, invalid: file.invalid.length } : summary);
  const late = Object.values(useRegisterSummaries.getState().summaries).reduce(
    (n, s) => n + s.late,
    0,
  );
  useNeedsYou.getState().setRegisters(late);
  useDockBadgeStore.getState().setBadge("pmo-toolkit", late);
}
