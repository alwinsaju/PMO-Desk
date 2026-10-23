"use client";

import { useCallback, useSyncExternalStore } from "react";
import { setTheme as applyTheme, type Theme } from "./theme";

/**
 * React binding for the theme in `src/lib/theme.ts`. There is deliberately
 * NO store of its own: the single source of truth is the `data-theme`
 * attribute on <html> (written by `setTheme`, and by the pre-hydration init
 * script in layout.tsx), with localStorage as its persistence. This hook
 * just subscribes to that attribute, so any number of components stay in
 * sync no matter who flipped it.
 *
 * The server snapshot is "light" (the attribute doesn't exist during SSR);
 * anything that renders this value into server-rendered markup would
 * re-render once on the client if the stored theme is dark.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

function getServerSnapshot(): Theme {
  return "light";
}

export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void } {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setTheme = useCallback((next: Theme) => applyTheme(next), []);
  return { theme, setTheme };
}
