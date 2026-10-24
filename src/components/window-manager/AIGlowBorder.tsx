"use client";

import { motion } from "motion/react";

/**
 * The rotating conic "AI is driving this window" ring, drawn around a window
 * when `controlledBy === "ai"` — Window.tsx mounts this conditionally, as a
 * SIBLING (after) the window's clipped/rounded chrome, not a child of it.
 * Same reason ResizeHandles is a sibling rather than a child (see that file):
 * the chrome's own `overflow-hidden` (needed to clip app content to the
 * window's rounded corners) would clip a ring that sits just outside the
 * window's edge.
 *
 * The ring itself is the design system's `ai-ring` utility (globals.css): a
 * masked conic gradient from `--ring-colors` whose angle spins on a CSS
 * `@property` animation — multicolor by default, the brand gradient in
 * Deloitte mode — so this component never touches React state or re-renders
 * on an animation frame, and it is a still ring under
 * `prefers-reduced-motion`. A soft accent bloom (box-shadow) sits around it.
 *
 * `ai-ring` makes its element `position: relative` (it needs a positioned
 * box for its `::after`), which would fight an `absolute inset-0` on the same
 * element — hence the plain absolutely-positioned wrapper with the ring on a
 * full-size child. The wrapper also fades in via `motion`, since a ring that
 * mounts the instant control is handed over would otherwise pop.
 *
 * No props: purely decorative, and Window.tsx already owns the
 * `controlledBy === "ai"` check that decides whether to mount this at all.
 */
export function AIGlowBorder() {
  return (
    <motion.div
      aria-hidden="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="pointer-events-none absolute inset-0 z-[3]"
    >
      <div className="ai-ring rounded-surface h-full w-full shadow-[0_0_46px_-8px_var(--color-accent)]" />
    </motion.div>
  );
}
