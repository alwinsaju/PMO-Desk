// Where the toast stack is drawn: inside the active window (bottom right), so a
// toast never sits half outside it. Pure; ToastHost measures the window.

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Least visible window area that can hold a toast (22rem wide plus padding). */
const MIN_WIDTH = 360;
const MIN_HEIGHT = 120;

/** The on-screen part of the active window, or null when there is no such window or too
 *  little of it shows - the host then uses the bottom-right corner of the screen. */
export function toastAnchorBox(
  win: Box | null,
  viewport: { width: number; height: number },
): Box | null {
  if (!win) return null;
  const left = Math.max(win.left, 0);
  const top = Math.max(win.top, 0);
  const right = Math.min(win.left + win.width, viewport.width);
  const bottom = Math.min(win.top + win.height, viewport.height);
  const width = right - left;
  const height = bottom - top;
  if (width < MIN_WIDTH || height < MIN_HEIGHT) return null;
  return { left, top, width, height };
}
