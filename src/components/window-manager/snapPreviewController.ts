// The live snap preview while a window is dragged. One fixed element (SnapPreview.tsx)
// is moved by direct DOM updates: no store write and no React state, so a drag stays
// free of renders. The element only changes when the target rect changes, not on every
// pointer-move frame.
import { windowDefaults } from "@/lib/tokens";
import { snapTarget } from "./windowSnap";

let node: HTMLElement | null = null;
/** The geometry currently drawn, or null while hidden. */
let shown: string | null = null;

/** SnapPreview hands over its element on mount and null on unmount. */
export function registerSnapPreview(el: HTMLElement | null): void {
  node = el;
  shown = null;
}

/** Shows (or moves) the preview for a pointer at `point` (viewport pixels), or hides it
 *  when no snap zone applies there. Call it from the drag callback every frame. */
export function updateSnapPreview(point: { x: number; y: number }): void {
  if (!node) return;
  const target = snapTarget(
    point,
    { width: window.innerWidth, height: window.innerHeight },
    windowDefaults.insets,
  );
  if (!target) return hideSnapPreview();
  const { x, y, width, height } = target.rect;
  const key = `${target.zone}:${x},${y},${width},${height}`;
  if (key === shown) return;
  const wasHidden = shown === null;
  if (wasHidden) {
    // Appear in place instead of sliding in from wherever it was last.
    node.style.transition = "none";
  }
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  node.style.width = `${width}px`;
  node.style.height = `${height}px`;
  node.setAttribute("data-zone", target.zone);
  if (wasHidden) {
    void node.offsetWidth; // flush so the jump above is not animated
    node.style.transition = "";
  }
  node.setAttribute("data-state", "shown");
  shown = key;
}

/** Hides the preview (release, cancel, or the pointer leaving every zone). */
export function hideSnapPreview(): void {
  if (shown === null) return;
  shown = null;
  node?.setAttribute("data-state", "hidden");
}
