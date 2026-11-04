"use client";

import { useEffect } from "react";
import { useDrag } from "@use-gesture/react";
import { useWindowStore, windowClampConfig } from "./windowStore";
import { clampToViewport, windowTransform } from "./windowGeometry";
import { edgeZone } from "./windowSnap";
import { hideSnapPreview, updateSnapPreview } from "./snapPreviewController";

/** `data-gesture` on the window node while a drag/resize is live: tokens.css
 *  gives only that window `will-change: transform` + contained chrome, and
 *  globals.css switches text selection off page-wide for the duration. */
export function markGesture(el: HTMLElement, active: boolean): void {
  if (active) {
    el.setAttribute("data-gesture", "");
    // Drop a selection made before the drag started.
    window.getSelection()?.removeAllRanges();
  } else el.removeAttribute("data-gesture");
}

/**
 * Drag-to-move for a window. Performance-critical: while the pointer is
 * down, this writes `transform` directly onto `elementRef`'s DOM node every
 * frame and touches NO React state and NO Zustand store — so dragging never
 * triggers a re-render. The final position is only committed to the store
 * (a single `moveWindow` call) on pointer-up.
 *
 * `from` is a function (not a fixed tuple) so each new drag gesture starts
 * from wherever the window's position currently is in the store, rather
 * than from @use-gesture's own internal memory of the last gesture.
 *
 * Spread the returned `bind()` onto the draggable handle (the title bar),
 * not the whole window — but pass the ref of the OUTER window element
 * (the one whose `transform` actually represents the window's position).
 *
 * Doesn't call `focusWindow` itself — Window.tsx's OUTER element already has
 * a plain `onPointerDown` that focuses on ANY press inside the window
 * (titlebar, resize handles, or body content alike). Since the titlebar is
 * a descendant of that element, the same physical pointerdown that starts a
 * drag always bubbles up through it too, so focusing here as well would
 * just double-bump zIndex for no benefit.
 */
export function useWindowDrag(
  id: string,
  elementRef: React.RefObject<HTMLElement | null>,
  options: { disabled?: boolean } = {},
) {
  const { disabled = false } = options;

  // A window that closes mid-drag never sees its release: do not leave the outline up.
  useEffect(() => hideSnapPreview, []);

  return useDrag(
    ({ offset: [rawX, rawY], xy, first, last }) => {
      if (disabled) return;
      const size = useWindowStore.getState().windows[id]?.size;
      const { x, y } = size
        ? clampToViewport(
            { x: rawX, y: rawY, ...size },
            { width: window.innerWidth, height: window.innerHeight },
            windowClampConfig,
          )
        : { x: rawX, y: rawY };
      const el = elementRef.current;
      if (el) {
        if (first) markGesture(el, true);
        el.style.transform = windowTransform({ x, y });
        if (last) markGesture(el, false);
      }
      // Live outline of where a release here would snap (direct DOM, no store/state).
      if (last) hideSnapPreview();
      else updateSnapPreview({ x: xy[0], y: xy[1] });
      if (last) {
        // Let go at the left or right edge of the screen: snap to half (or a quarter near a corner).
        const zone = edgeZone(
          { x: xy[0], y: xy[1] },
          { width: window.innerWidth, height: window.innerHeight },
        );
        if (zone) useWindowStore.getState().snapWindow(id, zone);
        else useWindowStore.getState().moveWindow(id, { x, y });
        // The node still holds the raw drag position. React only rewrites `transform`
        // when the stored position changed, so a snap onto the position the window
        // already had (or a plain drop) would leave it where the pointer let go.
        const placed = useWindowStore.getState().windows[id]?.position;
        if (el && placed) el.style.transform = windowTransform(placed);
      }
    },
    {
      from: (): [number, number] => {
        const w = useWindowStore.getState().windows[id];
        return [w?.position.x ?? 0, w?.position.y ?? 0];
      },
      enabled: !disabled,
    },
  );
}
