"use client";

import { useDrag } from "@use-gesture/react";
import { useWindowStore } from "./windowStore";

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

  return useDrag(
    ({ offset: [x, y], last }) => {
      if (disabled) return;
      const el = elementRef.current;
      if (el) {
        el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
      if (last) {
        useWindowStore.getState().moveWindow(id, { x, y });
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
