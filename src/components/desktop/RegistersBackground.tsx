"use client";

import { useEffect } from "react";
import { refreshRegisterSummaries } from "@/lib/dashboard/refreshRegisterSummaries";

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
      if (stopped) return;
      await refreshRegisterSummaries();
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
