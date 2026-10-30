"use client";

import { useEffect } from "react";
import { fetchSummaries } from "@/components/apps/toolkit/registersApi";
import { useRegisterSummaries } from "@/components/apps/toolkit/summariesStore";
import { useDockBadgeStore } from "@/components/taskbar/dockBadgeStore";
import { useNeedsYou } from "@/lib/dashboard/needsYouStore";

const FIRST_MS = 12_000;
const EVERY_MS = 60_000;

/**
 * Renders nothing. Every minute it reads how many items in the PMO tools are late or due soon, and shows the
 * late ones in the "needs you" count and on the PMO Toolkit's dock icon. It only reads.
 */
export function RegistersBackground() {
  useEffect(() => {
    let stopped = false;

    async function check() {
      const reply = await fetchSummaries();
      if (stopped || !reply.ok) return;
      useRegisterSummaries.getState().set(reply.summaries);
      const late = reply.summaries.reduce((n, s) => n + s.late, 0);
      useNeedsYou.getState().setRegisters(late);
      useDockBadgeStore.getState().setBadge("pmo-toolkit", late);
    }

    const first = setTimeout(() => void check(), FIRST_MS);
    const every = setInterval(() => void check(), EVERY_MS);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);

  return null;
}
