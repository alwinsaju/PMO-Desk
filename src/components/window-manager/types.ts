import type { ReactNode } from "react";

/** Who is currently driving this window's UI. The core product differentiator
 *  — control can pass either direction after a window is opened. */
export type ControlledBy = "human" | "ai";

export interface WindowPosition {
  x: number;
  y: number;
}

export interface WindowSize {
  width: number;
  height: number;
}

export interface WindowState {
  id: string;
  /** Key into the app registry (see src/components/apps/registry.ts). */
  appId: string;
  title: string;
  icon?: ReactNode;
  position: WindowPosition;
  size: WindowSize;
  /** Stacking order. Higher renders on top. Bumped via the store's
   *  monotonic `nextZIndex` counter — never set this by hand. */
  zIndex: number;
  isMinimized: boolean;
  isMaximized: boolean;
  /** Stays above the other windows (until unpinned), whichever one is focused. */
  pinned?: boolean;
  /** Exactly one window is focused at a time (or none, if all are minimized). */
  isFocused: boolean;
  controlledBy: ControlledBy;
  /** Set when `controlledBy` is "ai" and an agent task is driving this window. */
  aiTaskId?: string;
  /** Floor for resizeWindow; defaults to the global minimum (360x240). */
  minSize?: WindowSize;
  /** The URL a "web-app" window (src/components/apps/web-app/) should
   *  render. Unused by every other appId — set only when opening that one
   *  generic app (see app-store's appCatalog.ts for the real catalog
   *  entries that do this). */
  url?: string;
  /** Whether `url`'s site allows itself to be embedded in a cross-origin
   *  iframe. Deliberately NOT detected at runtime: a blocked cross-origin
   *  iframe can't be introspected from JS, and a blocked frame often fires
   *  no distinguishing load/error event either way. So this is a static
   *  flag, hand-verified once against the real site's actual response
   *  headers (`X-Frame-Options` / CSP `frame-ancestors` — see
   *  appCatalog.ts's comments) and passed in at openWindow time. Only
   *  meaningful alongside `url`. */
  embeddable?: boolean;
  /** Position/size to return to when un-maximizing. Internal to the store —
   *  set by maximizeWindow, consumed by maximizeWindow on toggle-off. Not
   *  meant to be read or written by feature code. */
  restoreBounds?: { position: WindowPosition; size: WindowSize };
}

export interface OpenWindowOptions {
  title?: string;
  icon?: ReactNode;
  position?: WindowPosition;
  size?: WindowSize;
  minSize?: WindowSize;
  controlledBy?: ControlledBy;
  aiTaskId?: string;
  /** See WindowState.url. */
  url?: string;
  /** See WindowState.embeddable. */
  embeddable?: boolean;
}
