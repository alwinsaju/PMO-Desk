/**
 * JS-readable mirror of `src/styles/tokens.css`.
 *
 * Use this when a value is needed OUTSIDE of a className string — animation
 * math, canvas/DOM measurements, computing a minimize-to-dock target, etc.
 * For everything else (99% of styling), prefer the Tailwind utility classes
 * generated from tokens.css (`bg-accent`, `rounded-window`, `shadow-float`,
 * `h-titlebar`, ...) over importing this file.
 *
 * Keep every value below byte-for-byte in sync with tokens.css. Neither file
 * generates the other — this is a hand-maintained mirror, not a build step.
 */

/**
 * Semantic layout sizes, in pixels. `dock` and `commandBar` are reserved
 * for the Desktop Shell & Chrome / AI Agent Layer phases — defined now so
 * every phase agrees on the same numbers before either surface exists
 * (e.g. for computing where a window should animate toward when minimized).
 */
export const sizes = {
  titlebarHeight: 54,
  dockHeight: 60,
  commandBarHeight: 58,
  /** Gap between the command bar and the viewport's bottom edge. */
  commandBarOffset: 26,
  /** Bottom strip the command bar occupies (offset + height). */
  commandBarReserve: 84,
  /** Bottom strip the corner avatars/AI orb occupy (bottom-7 offset + 48px orb). */
  presenceReserve: 76,
  /** Air kept between a window's bottom edge and the strips above. */
  bottomClearance: 12,
  controlHeight: 36,
  gutter: 24,
} as const;

/**
 * Static z-index layers. Matches the plain `:root` custom properties in
 * tokens.css (these are NOT Tailwind theme utilities — see the comment
 * there for why). `windowBase` is the starting value windowStore's
 * `nextZIndex` counter seeds from.
 */
export const zIndex = {
  desktop: 0,
  windowBase: 100,
  chrome: 2000,
  overlay: 3000,
} as const;

/** Window-manager behavior constants. See windowStore.ts / windowGeometry.ts. */
export const windowDefaults = {
  /** ONE size for every app (clamped to the viewport when a window opens). */
  size: { width: 1120, height: 680 },
  minSize: { width: 360, height: 240 },
  /** Per-window cascade step, in px. Shrinks when the viewport is tight. */
  cascadeOffset: 24,
  /** Wrap the cascade after this many opens so windows don't walk off-screen. */
  cascadeWrap: 8,
  /** Keep-clear margins (px): left/right edge, below the dock, above the
   *  command bar. A new window is placed inside them. */
  insets: {
    side: 12,
    top: 88,
    bottom:
      Math.max(sizes.commandBarReserve, sizes.presenceReserve) + sizes.bottomClearance,
  },
  /** Px of a window's title bar that must stay on screen horizontally. */
  titleBarReach: 80,
} as const;
