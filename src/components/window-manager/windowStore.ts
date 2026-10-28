import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { windowDefaults, sizes, zIndex as zIndexTokens } from "@/lib/tokens";
import type {
  ControlledBy,
  OpenWindowOptions,
  WindowPosition,
  WindowSize,
  WindowState,
} from "./types";
import {
  defaultWindowGeometry,
  fitRectToViewport,
  type FitConfig,
  type Viewport,
} from "./windowGeometry";

/** Numbers behind every "keep the title bar reachable" clamp. */
export const windowClampConfig: FitConfig = {
  titlebarHeight: sizes.titlebarHeight,
  minVisibleX: windowDefaults.titleBarReach,
  bottomReserve: sizes.commandBarReserve,
  insets: windowDefaults.insets,
};

export interface WindowStoreState {
  windows: Record<string, WindowState>;
  /** Monotonic counter — every focus-bringing-to-front action consumes the
   *  current value and increments it. Never decreases. */
  nextZIndex: number;
  /** How many windows have ever been opened this session. Only used to
   *  compute the cascade offset for the next open (windowGeometry.ts) — not
   *  decremented on close, and wraps via `windowDefaults.cascadeWrap` so
   *  cascades don't walk new windows off-screen in a long session. */
  openCount: number;

  openWindow: (appId: string, options?: OpenWindowOptions) => string;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  moveWindow: (id: string, position: WindowPosition) => void;
  resizeWindow: (id: string, size: WindowSize) => void;
  /** Re-fits every non-maximised window to `viewport` (viewport/DPI change). */
  clampAllToViewport: (viewport: Viewport) => void;
  minimizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  /** Toggles maximize on/off, restoring the pre-maximize bounds on toggle-off. */
  maximizeWindow: (id: string) => void;
  setWindowControlledBy: (
    id: string,
    controlledBy: ControlledBy,
    aiTaskId?: string,
  ) => void;
}

/**
 * Sets `isFocused: true` on `targetId` (optionally bumping its zIndex) and
 * `isFocused: false` on every other window — but ONLY creates new object
 * references for the entries that actually change. Every other window's
 * `WindowState` object keeps its original reference, so a per-window
 * selector like `useWindowStore((s) => s.windows[id])` correctly reports
 * "unchanged" for windows this action doesn't touch. Without this, focusing
 * one window would re-render every open window on every click.
 */
function withExclusiveFocus(
  windows: Record<string, WindowState>,
  targetId: string,
  zIndex?: number,
): Record<string, WindowState> {
  let next = windows;
  for (const [id, w] of Object.entries(windows)) {
    if (id === targetId) {
      const needsFocus = !w.isFocused;
      const needsZ = zIndex !== undefined && w.zIndex !== zIndex;
      if (needsFocus || needsZ) {
        if (next === windows) next = { ...windows };
        next[id] = {
          ...w,
          isFocused: true,
          ...(zIndex !== undefined ? { zIndex } : {}),
        };
      }
    } else if (w.isFocused) {
      if (next === windows) next = { ...windows };
      next[id] = { ...w, isFocused: false };
    }
  }
  return next;
}

/** id of the topmost (highest zIndex) window still eligible to receive
 *  focus, excluding `excludeId` (the window being closed/minimized). */
function topmostRemaining(
  windows: Record<string, WindowState>,
  excludeId: string,
): string | undefined {
  let best: WindowState | undefined;
  for (const w of Object.values(windows)) {
    if (w.id === excludeId || w.isMinimized) continue;
    if (!best || w.zIndex > best.zIndex) best = w;
  }
  return best?.id;
}

export const useWindowStore = create<WindowStoreState>()((set) => ({
  windows: {},
  nextZIndex: zIndexTokens.windowBase,
  openCount: 0,

  openWindow: (appId, options = {}) => {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `win-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    set((state) => {
      // One uniform default size for every app (shrunk to fit the viewport),
      // with a small cascade per new window. See windowGeometry.ts.
      const geometry = defaultWindowGeometry(
        state.openCount,
        typeof window !== "undefined"
          ? { width: window.innerWidth, height: window.innerHeight }
          : null,
        windowDefaults,
      );
      const position: WindowPosition = options.position ?? geometry.position;
      const size: WindowSize = options.size ?? geometry.size;
      const zIndex = state.nextZIndex;

      const newWindow: WindowState = {
        id,
        appId,
        title: options.title ?? appId,
        icon: options.icon,
        position,
        size,
        zIndex,
        isMinimized: false,
        isMaximized: false,
        isFocused: true,
        controlledBy: options.controlledBy ?? "human",
        aiTaskId: options.aiTaskId,
        minSize: options.minSize ?? { ...windowDefaults.minSize },
        url: options.url,
        embeddable: options.embeddable,
      };

      const withNewWindow = { ...state.windows, [id]: newWindow };

      return {
        windows: withExclusiveFocus(withNewWindow, id, zIndex),
        nextZIndex: zIndex + 1,
        openCount: state.openCount + 1,
      };
    });

    return id;
  },

  closeWindow: (id) => {
    set((state) => {
      if (!(id in state.windows)) return state;
      const rest = { ...state.windows };
      delete rest[id];
      const nextFocusId = topmostRemaining(rest, id);
      return {
        windows: nextFocusId ? withExclusiveFocus(rest, nextFocusId) : rest,
      };
    });
  },

  focusWindow: (id) => {
    set((state) => {
      if (!(id in state.windows)) return state;
      const zIndex = state.nextZIndex;
      return {
        windows: withExclusiveFocus(state.windows, id, zIndex),
        nextZIndex: zIndex + 1,
      };
    });
  },

  moveWindow: (id, position) => {
    set((state) => {
      const w = state.windows[id];
      if (!w) return state;
      return { windows: { ...state.windows, [id]: { ...w, position } } };
    });
  },

  resizeWindow: (id, size) => {
    set((state) => {
      const w = state.windows[id];
      if (!w) return state;
      const min = w.minSize ?? windowDefaults.minSize;
      const clamped: WindowSize = {
        width: Math.max(min.width, size.width),
        height: Math.max(min.height, size.height),
      };
      return { windows: { ...state.windows, [id]: { ...w, size: clamped } } };
    });
  },

  clampAllToViewport: (viewport) => {
    set((state) => {
      let next = state.windows;
      for (const w of Object.values(state.windows)) {
        const min = w.minSize ?? windowDefaults.minSize;
        // A maximised window follows the viewport by itself; only its saved
        // restore rect needs to stay reachable.
        const current = w.isMaximized
          ? w.restoreBounds
          : { position: w.position, size: w.size };
        if (!current) continue;
        const rect = { ...current.position, ...current.size };
        const fitted = fitRectToViewport(rect, viewport, windowClampConfig, min);
        if (fitted === rect) continue;
        const bounds = {
          position: { x: fitted.x, y: fitted.y },
          size: { width: fitted.width, height: fitted.height },
        };
        if (next === state.windows) next = { ...state.windows };
        next[w.id] = w.isMaximized
          ? { ...w, restoreBounds: bounds }
          : { ...w, position: bounds.position, size: bounds.size };
      }
      return next === state.windows ? state : { windows: next };
    });
  },

  minimizeWindow: (id) => {
    set((state) => {
      const w = state.windows[id];
      if (!w || w.isMinimized) return state;
      const nextFocusId = topmostRemaining(state.windows, id);
      const withMinimized = {
        ...state.windows,
        [id]: { ...w, isMinimized: true, isFocused: false },
      };
      return {
        windows: nextFocusId
          ? withExclusiveFocus(withMinimized, nextFocusId)
          : withMinimized,
      };
    });
  },

  restoreWindow: (id) => {
    set((state) => {
      const w = state.windows[id];
      if (!w) return state;
      const zIndex = state.nextZIndex;
      const withRestored = {
        ...state.windows,
        [id]: { ...w, isMinimized: false },
      };
      return {
        windows: withExclusiveFocus(withRestored, id, zIndex),
        nextZIndex: zIndex + 1,
      };
    });
  },

  maximizeWindow: (id) => {
    set((state) => {
      const w = state.windows[id];
      if (!w) return state;
      const zIndex = state.nextZIndex;

      let updated: WindowState;
      if (w.isMaximized) {
        // Restore to pre-maximize bounds.
        const bounds = w.restoreBounds;
        updated = {
          ...w,
          isMaximized: false,
          position: bounds?.position ?? w.position,
          size: bounds?.size ?? w.size,
          restoreBounds: undefined,
        };
      } else {
        updated = {
          ...w,
          isMaximized: true,
          restoreBounds: { position: w.position, size: w.size },
        };
      }

      return {
        windows: withExclusiveFocus({ ...state.windows, [id]: updated }, id, zIndex),
        nextZIndex: zIndex + 1,
      };
    });
  },

  setWindowControlledBy: (id, controlledBy, aiTaskId) => {
    set((state) => {
      const w = state.windows[id];
      if (!w) return state;
      return {
        windows: {
          ...state.windows,
          [id]: {
            ...w,
            controlledBy,
            aiTaskId: controlledBy === "ai" ? aiTaskId : undefined,
          },
        },
      };
    });
  },
}));

// ---------------------------------------------------------------------------
// Convenience selector hooks. Prefer these (or a per-id selector shaped like
// `useWindowStore((s) => s.windows[id])`) over subscribing to the whole store
// so a component only re-renders when the slice it actually reads changes.
// ---------------------------------------------------------------------------

/** Ids of every open, non-minimized window. Safe to use with `useShallow`
 *  because the array elements are string primitives (value-compared). */
export function useVisibleWindowIds(): string[] {
  return useWindowStore(
    useShallow((s) =>
      Object.values(s.windows)
        .filter((w) => !w.isMinimized)
        .map((w) => w.id),
    ),
  );
}

/** Ids of every open window, including minimized ones (e.g. for a future
 *  taskbar/dock listing). */
export function useAllWindowIds(): string[] {
  return useWindowStore(useShallow((s) => Object.keys(s.windows)));
}

// Also re-export the getState() escape hatch's return type usage is implicit
// via useWindowStore.getState() at call sites (e.g. gesture hooks) that need
// a non-reactive read.
