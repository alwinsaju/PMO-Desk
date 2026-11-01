/**
 * Visual-effects mode ("Hardware acceleration" setting): ONE attribute on
 * <html> plus one localStorage key, mirroring the theme/brand pattern in
 * `theme.ts`.
 *
 *   Rich — `data-fx="rich"`   effects ON: live-blur wallpaper + drift, heavy
 *                             glass/backdrop blurs (see globals.css)
 *   Lean — attribute absent   the default: the cheap baked-gradient look
 *
 * Both looks live in the same CSS; `:root[data-fx="rich"]` (globals.css) is the
 * whole mechanism. In the desktop app the saved value comes from the shell
 * (`window.aiOsDesktop.displayMode`, read from <userData>/display-settings.json,
 * the same file that decides whether Chromium may use the GPU at all) and
 * localStorage is only its mirror; in a plain browser localStorage is the
 * source and there is no GPU switch (a page cannot control that).
 */

export type FxMode = "lean" | "rich";

export const FX_STORAGE_KEY = "ai-os:fx";

/** What the desktop shell reports (see desktop/display-settings.cjs). */
export interface DesktopDisplayState {
  /** The saved setting (applies to the GPU only after a restart). */
  saved: boolean;
  /** Whether THIS process was started with hardware acceleration allowed. */
  launchedWithGpu: boolean;
  /** Chromium's gpu_compositing status ("enabled" = really on the GPU). */
  compositing: string;
  gpuCompositing: boolean;
  /** The GPU was allowed but there is no hardware graphics acceleration. */
  noHardwareAcceleration?: boolean;
  /** Set when saving the setting failed. */
  error?: string;
}

/** window.aiOsDesktop.display (desktop/preload.cjs). */
export interface DesktopDisplayBridge {
  getState: () => Promise<DesktopDisplayState | null>;
  setHardwareAcceleration: (enabled: boolean) => Promise<DesktopDisplayState | null>;
  relaunch: () => Promise<boolean>;
}

type BridgeShape = { displayMode?: unknown; display?: DesktopDisplayBridge };

function bridge(): BridgeShape | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { aiOsDesktop?: BridgeShape }).aiOsDesktop;
}

/** The desktop shell's display bridge; undefined in a plain browser. */
export function getDisplayBridge(): DesktopDisplayBridge | undefined {
  return bridge()?.display;
}

/** Reads the persisted mode (the shell's saved value in the desktop app,
 *  otherwise localStorage). Safe to call from a Server Component. */
export function getStoredFx(): FxMode {
  if (typeof window === "undefined") return "lean";
  const shell = bridge();
  if (shell && typeof shell.displayMode === "string") {
    return shell.displayMode === "rich" ? "rich" : "lean";
  }
  try {
    return window.localStorage.getItem(FX_STORAGE_KEY) === "rich" ? "rich" : "lean";
  } catch {
    return "lean";
  }
}

/** Applies `mode` to <html> and persists it in localStorage. (The desktop
 *  shell's own copy, which also drives the GPU, is written by the Settings
 *  row through `getDisplayBridge()`.) */
export function setFx(mode: FxMode): void {
  if (typeof document !== "undefined") {
    if (mode === "rich") {
      document.documentElement.setAttribute("data-fx", "rich");
    } else {
      document.documentElement.removeAttribute("data-fx");
    }
  }
  try {
    window.localStorage.setItem(FX_STORAGE_KEY, mode);
  } catch {
    // Works for the current tab, just won't survive a reload.
  }
}

/**
 * Source for the root layout's `beforeInteractive` inline script, run together
 * with the theme init script so `data-fx` is on <html> before the first paint
 * (no flash of the wrong look). Plain string for the same reason as
 * `getThemeInitScript`; the desktop shell's value wins over localStorage.
 */
export function getFxInitScript(): string {
  const key = JSON.stringify(FX_STORAGE_KEY);
  return (
    `(function(){var d=document.documentElement;var rich=false;` +
    `try{var s=window.aiOsDesktop;` +
    `if(s&&typeof s.displayMode==="string"){rich=s.displayMode==="rich";}` +
    `else{rich=window.localStorage.getItem(${key})==="rich";}}catch(e){}` +
    `if(rich){d.setAttribute("data-fx","rich");}` +
    `})();`
  );
}

/** Up to this many open windows every window keeps the full look. */
export const FULL_FX_MAX_WINDOWS = { rich: 4, lean: 4 } as const;

export type WindowFx = "full" | "lean";

/** Per-window style: with many windows open the unfocused ones drop heavy
 *  shadows (and blur, in rich mode) — `data-fx-win` on the window, see tokens.css. */
export function windowFxMode(input: {
  openCount: number;
  focused: boolean;
  lean: boolean;
}): WindowFx {
  const { openCount, focused, lean } = input;
  if (focused) return "full";
  const max = lean ? FULL_FX_MAX_WINDOWS.lean : FULL_FX_MAX_WINDOWS.rich;
  return openCount > max ? "lean" : "full";
}

export interface HardwareAccelerationView {
  /** The switch position. */
  checked: boolean;
  /** The switch cannot be changed (no hardware acceleration on this machine). */
  disabled: boolean;
  /** One short helper line under the title. */
  hint: string;
  /** Extra warning line, or null. */
  warning: string | null;
  /** The saved GPU choice differs from what this process started with. */
  restartNeeded: boolean;
}

export const HARDWARE_ACCELERATION_HINT =
  "GPU rendering and rich blur effects. Leave off on weak graphics.";
export const NO_HARDWARE_ACCELERATION_REASON =
  "This computer has no hardware graphics acceleration; the lean mode is used.";
const WEB_HINT = "Rich blur effects. The browser manages the GPU itself.";
const RESTART_HINT = "Restart PMO Desk to apply the GPU change.";
export const GPU_UNAVAILABLE_WARNING =
  "GPU not available on this machine - rich effects may be slow.";

/** What the Settings row shows, as a pure function of the mode and what the
 *  desktop shell reported (`state` is null in a browser or before it answered). */
export function describeHardwareAcceleration(input: {
  fx: FxMode;
  desktop: boolean;
  state: DesktopDisplayState | null;
  error?: string | null;
}): HardwareAccelerationView {
  const { fx, desktop, state, error } = input;
  const checked = fx === "rich";
  if (!desktop) {
    return {
      checked,
      disabled: false,
      hint: WEB_HINT,
      warning: null,
      restartNeeded: false,
    };
  }
  if (state?.noHardwareAcceleration) {
    return {
      checked: false,
      disabled: true,
      hint: NO_HARDWARE_ACCELERATION_REASON,
      warning: null,
      restartNeeded: false,
    };
  }
  const restartNeeded = Boolean(state && state.saved !== state.launchedWithGpu);
  let warning: string | null = error ?? null;
  if (
    !warning &&
    state &&
    !restartNeeded &&
    checked &&
    state.launchedWithGpu &&
    !state.gpuCompositing
  ) {
    warning = GPU_UNAVAILABLE_WARNING;
  }
  return {
    checked,
    disabled: false,
    hint: restartNeeded ? RESTART_HINT : HARDWARE_ACCELERATION_HINT,
    warning,
    restartNeeded,
  };
}
