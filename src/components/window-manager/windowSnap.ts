// Snap layouts: put a window on half or a quarter of the screen. Pure; windowStore applies
// the result. The keep-clear insets (dock above, command bar below) are respected.
import type { Rect, Viewport } from "./windowGeometry.ts";

export type SnapZone =
  "left" | "right" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

export const SNAP_GAP = 8;

interface Insets {
  side: number;
  top: number;
  bottom: number;
}

export function snapRect(zone: SnapZone, viewport: Viewport, insets: Insets): Rect {
  const x0 = insets.side;
  const y0 = insets.top;
  const width = Math.max(0, viewport.width - insets.side * 2);
  const height = Math.max(0, viewport.height - insets.top - insets.bottom);
  const half = Math.floor((width - SNAP_GAP) / 2);
  const halfH = Math.floor((height - SNAP_GAP) / 2);
  const right = x0 + width - half;
  const bottom = y0 + height - halfH;
  switch (zone) {
    case "left":
      return { x: x0, y: y0, width: half, height };
    case "right":
      return { x: right, y: y0, width: half, height };
    case "top-left":
      return { x: x0, y: y0, width: half, height: halfH };
    case "top-right":
      return { x: right, y: y0, width: half, height: halfH };
    case "bottom-left":
      return { x: x0, y: bottom, width: half, height: halfH };
    case "bottom-right":
      return { x: right, y: bottom, width: half, height: halfH };
  }
}

/** The zone a window dropped with the pointer at `point` should snap to, or null in the middle. */
export function edgeZone(
  point: { x: number; y: number },
  viewport: Viewport,
  edge = 8,
  corner = 90,
): SnapZone | null {
  const nearLeft = point.x <= edge;
  const nearRight = point.x >= viewport.width - edge;
  if (nearLeft || nearRight) {
    if (point.y <= corner) return nearLeft ? "top-left" : "top-right";
    if (point.y >= viewport.height - corner)
      return nearLeft ? "bottom-left" : "bottom-right";
    return nearLeft ? "left" : "right";
  }
  // Top and bottom edges do nothing here (the top edge is the dock; maximise is its own button).
  return null;
}

export type SnapKey = SnapZone | "maximize" | "restore";

/** Ctrl+Alt+arrows: left/right halves, up = maximise, down = restore the size it had.
 *  Ctrl+Alt+7, 9, 1, 3 are the four corners (laid out like a number pad). */
export function snapKey(event: {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}): SnapKey | null {
  if (!event.ctrlKey || !event.altKey || event.metaKey || event.shiftKey) return null;
  switch (event.key) {
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "ArrowUp":
      return "maximize";
    case "ArrowDown":
      return "restore";
    case "7":
      return "top-left";
    case "9":
      return "top-right";
    case "1":
      return "bottom-left";
    case "3":
      return "bottom-right";
  }
  return null;
}
