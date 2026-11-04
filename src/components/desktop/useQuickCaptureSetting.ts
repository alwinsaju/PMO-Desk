"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  describeQuickCapture,
  getQuickCaptureBridge,
  type QuickCaptureState,
  type QuickCaptureView,
} from "@/lib/quickCapture";

/**
 * State for the settings menu's "Quick capture" row (desktop app only). The shell owns the
 * global hotkey and its saved setting; this keeps its last report in a small module-level
 * store so it survives the menu closing (the rows unmount with it), like the
 * hardware-acceleration row's. A shortcut another app owns comes back as `state.error`.
 */
interface Snapshot {
  state: QuickCaptureState | null;
  error: string | null;
}

let snapshot: Snapshot = { state: null, error: null };
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
  const bridge = getQuickCaptureBridge();
  if (!bridge) return;
  try {
    update({ state: await bridge.getState(), error: null });
  } catch {
    // Keep what we had; the row still shows the last known state.
  }
}

async function toggle(enabled: boolean) {
  const bridge = getQuickCaptureBridge();
  if (!bridge) return;
  try {
    const state = await bridge.setEnabled(enabled);
    update(state ? { state, error: null } : { error: "Could not change the setting." });
  } catch {
    update({ error: "Could not change the setting." });
  }
}

export function useQuickCaptureSetting(): {
  /** False in a plain browser: there is no global hotkey, so the row is not shown. */
  available: boolean;
  view: QuickCaptureView;
  toggle: (enabled: boolean) => void;
} {
  const current = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
  // Bridge presence is a client-only fact; rows only render after the menu is opened.
  const available =
    typeof window !== "undefined" && getQuickCaptureBridge() !== undefined;

  useEffect(() => {
    void refresh();
  }, []);

  return {
    available,
    view: describeQuickCapture({ state: current.state, error: current.error }),
    toggle: useCallback((enabled: boolean) => void toggle(enabled), []),
  };
}
