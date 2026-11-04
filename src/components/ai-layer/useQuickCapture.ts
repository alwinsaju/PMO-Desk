"use client";

import { useEffect, useRef } from "react";
import { getDesktopBridge } from "@/lib/pmo/desktopBridge";

/** What the global quick-capture hotkey puts in the command bar: the slash command that
 *  adds a to-do, ready for the text (see slashCommands.ts). */
export const QUICK_CAPTURE_PREFIX = "/todo ";

/**
 * Calls `onCapture` when the desktop shell's opt-in global hotkey is pressed (the shell has
 * already shown and focused the window). Nothing happens in a plain browser tab, where
 * `window.aiOsDesktop` does not exist, or with the hotkey off (the shell never sends it).
 */
export function useQuickCapture(onCapture: () => void) {
  const callback = useRef(onCapture);
  useEffect(() => {
    callback.current = onCapture;
  });
  useEffect(() => getDesktopBridge()?.onQuickCapture?.(() => callback.current()), []);
}
