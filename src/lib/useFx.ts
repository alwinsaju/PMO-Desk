"use client";

import { useCallback, useSyncExternalStore } from "react";
import { setFx as applyFx, type FxMode } from "./displayFx";

/**
 * React binding for the visual-effects mode in `src/lib/displayFx.ts`,
 * mirroring `useBrand`: no store of its own, the `data-fx` attribute on <html>
 * is the single source of truth. Server snapshot is "lean" (the attribute does
 * not exist during SSR).
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-fx"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): FxMode {
  return document.documentElement.getAttribute("data-fx") === "rich" ? "rich" : "lean";
}

function getServerSnapshot(): FxMode {
  return "lean";
}

export function useFx(): { fx: FxMode; setFx: (fx: FxMode) => void } {
  const fx = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setFx = useCallback((next: FxMode) => applyFx(next), []);
  return { fx, setFx };
}
