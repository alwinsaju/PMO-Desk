"use client";

import { registerSnapPreview } from "./snapPreviewController";

/**
 * The outline that shows where a dragged window will snap (see snapPreviewController.ts, which
 * moves it by direct DOM updates). It is `fixed` and a sibling of the windows, never a
 * child of one: a window being dragged has `contain: layout paint` (tokens.css), which
 * would clip and offset anything inside it. Pointer-transparent and hidden from
 * assistive tech; it sits above the windows so a window cannot cover it. Reduced motion
 * drops the move and fade (the `motion-reduce` variant plus the app's own setting in
 * accessibility.css).
 */
export function SnapPreview() {
  return (
    <div
      ref={registerSnapPreview}
      aria-hidden
      data-snap-preview
      data-state="hidden"
      className={
        "rounded-surface bg-accent-soft border-accent pointer-events-none fixed z-[2147483000] border-2 opacity-0 " +
        "ease-standard transition-[left,top,width,height,opacity] duration-150 " +
        "data-[state=shown]:opacity-100 motion-reduce:transition-none"
      }
    />
  );
}
