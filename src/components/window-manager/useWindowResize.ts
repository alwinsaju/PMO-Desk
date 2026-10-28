"use client";

import { useDrag } from "@use-gesture/react";
import { windowDefaults } from "@/lib/tokens";
import { useWindowStore, windowClampConfig } from "./windowStore";
import { clampToViewport } from "./windowGeometry";
import { markGesture } from "./useWindowDrag";
import type { WindowPosition, WindowSize } from "./types";

export type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface ResizeMemo {
  position: WindowPosition;
  size: WindowSize;
}

/**
 * Resize-from-edge for one of a window's 8 resize handles. Same ref-first
 * performance pattern as useWindowDrag: writes `transform`/`width`/`height`
 * straight onto the DOM node every frame, and only commits to the store
 * (`moveWindow` + `resizeWindow`) on pointer-up.
 *
 * Unlike dragging, resizing needs the START position/size (captured once
 * into `memo` on `first`) plus the raw `movement` since then, because
 * shrinking from the top or left edge has to shift `x`/`y` by exactly the
 * clamped size delta — not the raw pointer delta — or the window appears to
 * slide once the minimum size clamp kicks in.
 *
 * Doesn't call `focusWindow` itself, for the same reason useWindowDrag
 * doesn't — the resize handles are siblings of the window's chrome but
 * still children of Window.tsx's OUTER element, so the pointerdown that
 * starts a resize already bubbles through that element's own
 * `onPointerDown` focus handler.
 */
export function useWindowResize(
  id: string,
  elementRef: React.RefObject<HTMLElement | null>,
  direction: ResizeDirection,
) {
  const affectsRight = direction.includes("e");
  const affectsLeft = direction.includes("w");
  const affectsBottom = direction.includes("s");
  const affectsTop = direction.includes("n");

  return useDrag(({ first, last, movement: [mx, my], memo }) => {
    const start: ResizeMemo =
      (memo as ResizeMemo | undefined) ??
      (() => {
        const w = useWindowStore.getState().windows[id];
        return {
          position: w?.position ?? { x: 0, y: 0 },
          size: w?.size ?? { ...windowDefaults.size },
        };
      })();

    const min = useWindowStore.getState().windows[id]?.minSize ?? windowDefaults.minSize;

    let { x, y } = start.position;
    let { width, height } = start.size;

    if (affectsRight) {
      width = Math.max(min.width, start.size.width + mx);
    }
    if (affectsBottom) {
      height = Math.max(min.height, start.size.height + my);
    }
    if (affectsLeft) {
      width = Math.max(min.width, start.size.width - mx);
      x = start.position.x + (start.size.width - width);
    }
    if (affectsTop) {
      height = Math.max(min.height, start.size.height - my);
      y = start.position.y + (start.size.height - height);
    }

    ({ x, y } = clampToViewport(
      { x, y, width, height },
      { width: window.innerWidth, height: window.innerHeight },
      windowClampConfig,
    ));

    const el = elementRef.current;
    if (el) {
      if (first) markGesture(el, true);
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
      if (last) markGesture(el, false);
    }

    if (last) {
      useWindowStore.getState().moveWindow(id, { x, y });
      useWindowStore.getState().resizeWindow(id, { width, height });
    }

    return start;
  });
}
