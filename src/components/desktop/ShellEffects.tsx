"use client";

import { useEffect } from "react";
import { openSettings } from "@/components/apps/settings-app/settingsNav";
import { isTypingTarget } from "@/components/apps/pmo-todo-app/listKeys";
import { usePreferences } from "@/lib/preferences/preferencesStore";
import { useStaffPrefs } from "@/lib/staff/staffPrefsStore";

/**
 * Renders nothing. Keeps <html data-motion / data-contrast> in step with the saved
 * accessibility preferences, and listens for the shell shortcuts: Ctrl+, opens Settings and
 * ? (outside a text field) opens the shortcut list.
 */
export function ShellEffects() {
  const reducedMotion = usePreferences((s) => s.reducedMotion);
  const highContrast = usePreferences((s) => s.highContrast);
  const colourBlindSafe = useStaffPrefs((s) => s.colourBlindSafe);

  useEffect(() => {
    const root = document.documentElement;
    if (reducedMotion) root.setAttribute("data-motion", "reduced");
    else root.removeAttribute("data-motion");
    if (highContrast) root.setAttribute("data-contrast", "high");
    else root.removeAttribute("data-contrast");
    if (colourBlindSafe) root.setAttribute("data-roster-colours", "safe");
    else root.removeAttribute("data-roster-colours");
  }, [reducedMotion, highContrast, colourBlindSafe]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key === ",") {
        event.preventDefault();
        openSettings("general");
        return;
      }
      if (
        event.key === "?" &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !isTypingTarget(event.target as HTMLElement | null)
      ) {
        event.preventDefault();
        openSettings("shortcuts");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
