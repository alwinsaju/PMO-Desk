"use client";

import { useEffect } from "react";
import { useDockBadgeStore } from "@/components/taskbar/dockBadgeStore";
import { useNeedsYouTotal } from "@/lib/dashboard/useNeedsYouTotal";
import { getDesktopBridge } from "@/lib/pmo/desktopBridge";
import { useStaffSync } from "@/lib/staff/staffStore";

/**
 * Renders nothing. Adds up what needs you (PMO items, leave waiting for a decision, tasks at a gate or
 * failed, late items in the PMO tools) and shows the total on the Dashboard's dock icon and on the
 * taskbar and tray (desktop app). The Dashboard's Today card shows the same number (useNeedsYouTotal).
 */
export function NeedsYouBadge() {
  useStaffSync();
  const { total, meaning } = useNeedsYouTotal();

  useEffect(() => {
    useDockBadgeStore.getState().setBadge("dashboard", total, meaning);
    getDesktopBridge()?.setBadge(total);
  }, [total, meaning]);

  return null;
}
