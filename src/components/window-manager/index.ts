// Public surface of the window manager. Other phases should import from
// here (or directly from these files) rather than reaching into internals
// like Window.tsx/WindowTitleBar.tsx/the gesture hooks, which are
// implementation details of how a window renders itself.

export { WindowManager } from "./WindowManager";
export { useWindowStore, useVisibleWindowIds, useAllWindowIds } from "./windowStore";
export type {
  WindowState,
  WindowPosition,
  WindowSize,
  ControlledBy,
  OpenWindowOptions,
} from "./types";
