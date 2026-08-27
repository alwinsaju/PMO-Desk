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
  /** Exactly one window is focused at a time (or none, if all are minimized). */
  isFocused: boolean;
  controlledBy: ControlledBy;
  /** Set when `controlledBy` is "ai" and an agent task is driving this window. */
  aiTaskId?: string;
  /** Floor for resizeWindow; defaults to the global minimum (360x240). */
  minSize?: WindowSize;
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
}
