"use client";

import { useEffect } from "react";
import { useRemindersStore } from "@/components/apps/pmo-todo-app/remindersStore";
import { attentionMeaning } from "@/components/taskbar/dockBadge";
import { useDockBadgeStore } from "@/components/taskbar/dockBadgeStore";
import { needsYouTotal } from "@/lib/dashboard/insights";
import { useNeedsYou } from "@/lib/dashboard/needsYouStore";
import { getDesktopBridge } from "@/lib/pmo/desktopBridge";
import { useStaffStore, useStaffSync } from "@/lib/staff/staffStore";

/**
 * Renders nothing. Adds up what needs you (PMO items, leave waiting for a decision, tasks at a gate or
 * failed) and shows the total on the Dashboard's dock icon and on the taskbar and tray (desktop app).
 */
export function NeedsYouBadge() {
  useStaffSync();
  const pmo = useRemindersStore((s) => s.attention);
  const leave = useStaffStore(
    (s) => s.timeOff.filter((r) => r.status === "pending").length,
  );
  const tasks = useNeedsYou((s) => s.tasks);
  const registers = useNeedsYou((s) => s.registers);
  const total = needsYouTotal({ pmo, leave, tasks, registers });

  const meaning = attentionMeaning({ pmo, leave, tasks, registers });

  useEffect(() => {
    useDockBadgeStore.getState().setBadge("dashboard", total, meaning);
    getDesktopBridge()?.setBadge(total);
  }, [total, meaning]);

  return null;
}
