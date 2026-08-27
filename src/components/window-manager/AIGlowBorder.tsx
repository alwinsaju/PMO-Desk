"use client";

/**
 * The animated "Siri glow" halo drawn around a window when
 * `controlledBy === "ai"` — Window.tsx mounts this conditionally, as a
 * SIBLING of the window's clipped/rounded chrome, not a child of it. Same
 * reason ResizeHandles is a sibling rather than a child (see that file):
 * the chrome's own `overflow-hidden` (needed to clip app content to the
 * window's rounded corners) would clip a glow that's specifically meant to
 * bleed out past the window's edge.
 *
 * Pure CSS: both animated layers (`.ai-glow-halo`/`.ai-glow-sweep`, plus the
 * `@keyframes`/`@property` that drive them) live in globals.css, so this
 * component never touches React state or re-renders on an animation frame —
 * it just mounts two absolutely-positioned, `pointer-events-none` divs and
 * lets the browser's own compositor run the loop. See globals.css's comment
 * above those rules for the full breakdown (why two layers, why an animated
 * `@property` instead of `transform: rotate()`, and how `prefers-reduced-
 * motion` is handled).
 *
 * No props: purely decorative, and Window.tsx already owns the
 * `controlledBy === "ai"` check that decides whether to mount this at all.
 */
export function AIGlowBorder() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
      {/* Bigger than the window and heavily blurred — its shape is never
          visible on its own, only the sliver that pokes out past the
          window's opaque body, which is what makes it read as a soft
          traveling bloom rather than a big rounded-rect blob. */}
      <div className="ai-glow-sweep absolute -inset-2.5 rounded-[1.625rem]" />
      {/* Exactly the window's own rect/radius, so its box-shadow layers
          radiate outward from the true edge. */}
      <div className="ai-glow-halo rounded-window absolute inset-0" />
    </div>
  );
}
