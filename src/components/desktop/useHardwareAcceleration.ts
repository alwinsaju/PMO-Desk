"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  describeHardwareAcceleration,
  getDisplayBridge,
  setFx,
  type DesktopDisplayState,
  type HardwareAccelerationView,
} from "@/lib/displayFx";
import { useFx } from "@/lib/useFx";

/**
 * State for the settings menu's "Hardware acceleration" row. The visual mode
 * (rich/lean CSS) is `data-fx` on <html> and switches immediately; in the
 * desktop app the same choice is also saved by the shell, which decides at the
 * NEXT start whether Chromium may use the GPU, hence the restart prompt. The
 * shell's report lives in a small module-level store so it survives the menu
 * closing (the rows unmount with it), like the backend-restart row's.
 */
interface Snapshot {
  state: DesktopDisplayState | null;
  error: string | null;
  relaunching: boolean;
}

let snapshot: Snapshot = { state: null, error: null, relaunching: false };
const listeners = new Set<() => void>();

function update(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function refresh() {
  const bridge = getDisplayBridge();
  if (!bridge) return;
  try {
    update({ state: await bridge.getState() });
  } catch {
    // Keep what we had; the row still works for the visual mode.
  }
}

async function toggle(enabled: boolean) {
  const bridge = getDisplayBridge();
  if (bridge) {
    try {
      const state = await bridge.setHardwareAcceleration(enabled);
      if (!state || state.error) {
        update({
          state: state ?? snapshot.state,
          error: state?.error ?? "Could not save the setting.",
        });
        return;
      }
      update({ state, error: null });
    } catch {
      update({ error: "Could not save the setting." });
      return;
    }
  }
  setFx(enabled ? "rich" : "lean");
}

async function relaunch() {
  const bridge = getDisplayBridge();
  if (!bridge || snapshot.relaunching) return;
  update({ relaunching: true });
  try {
    const restarting = await bridge.relaunch();
    // false = cancelled (a task is running and the user said no).
    if (!restarting) update({ relaunching: false });
  } catch {
    update({ relaunching: false, error: "Could not restart AI OS." });
  }
}

export function useHardwareAcceleration(): {
  view: HardwareAccelerationView;
  desktop: boolean;
  relaunching: boolean;
  toggle: (enabled: boolean) => void;
  relaunch: () => void;
} {
  const { fx } = useFx();
  const current = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
  // Bridge presence is a client-only fact; rows only render after the menu is
  // opened (client side), so reading it during render is safe.
  const desktop = typeof window !== "undefined" && getDisplayBridge() !== undefined;

  useEffect(() => {
    void refresh();
  }, []);

  return {
    view: describeHardwareAcceleration({
      fx,
      desktop,
      state: current.state,
      error: current.error,
    }),
    desktop,
    relaunching: current.relaunching,
    toggle: useCallback((enabled: boolean) => void toggle(enabled), []),
    relaunch: useCallback(() => void relaunch(), []),
  };
}
