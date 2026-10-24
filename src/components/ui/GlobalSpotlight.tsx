"use client";

import { useEffect } from "react";
import { onSpotlightMove } from "@/lib/spotlight";

/**
 * Effect-only component (renders nothing): one passive, document-level
 * `pointermove` listener that keeps the `--mx`/`--my` variables of whichever
 * `.spot` element is under the cursor up to date (see src/lib/spotlight.ts
 * and the `spot` utility in globals.css). Mounted once in layout.tsx, so any
 * card, row or tile just adds `className="spot"` — no per-component handlers.
 * `.spot` elements inside portaled overlays are covered too, since the
 * listener is on `document`.
 */
export function GlobalSpotlight() {
  useEffect(() => {
    const handler = (event: PointerEvent) => onSpotlightMove(event);
    document.addEventListener("pointermove", handler, { passive: true });
    return () => document.removeEventListener("pointermove", handler);
  }, []);
  return null;
}
