"use client";

import { useCallback, useSyncExternalStore } from "react";
import { setBrand as applyBrand, type Brand } from "./theme";

/**
 * React binding for the brand mode in `src/lib/theme.ts`, mirroring
 * `useTheme`. There is deliberately NO store of its own: the single source
 * of truth is the `data-brand` attribute on <html> (written by `setBrand`,
 * and by the pre-hydration init script in layout.tsx), with localStorage as
 * its persistence. This hook just subscribes to that attribute, so any
 * number of components stay in sync no matter who flipped it.
 *
 * Prefer tokens/CSS (`brand-dl:` variant, `:root[data-brand]` overrides)
 * over reading this hook — it exists for the rare JS need (the Settings
 * switch, a canvas that must pick palette colors).
 *
 * The server snapshot is "default" (the attribute doesn't exist during SSR);
 * anything that renders this value into server-rendered markup would
 * re-render once on the client if the stored brand is Deloitte.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-brand"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): Brand {
  return document.documentElement.getAttribute("data-brand") === "deloitte"
    ? "deloitte"
    : "default";
}

function getServerSnapshot(): Brand {
  return "default";
}

export function useBrand(): { brand: Brand; setBrand: (brand: Brand) => void } {
  const brand = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setBrand = useCallback((next: Brand) => applyBrand(next), []);
  return { brand, setBrand };
}
