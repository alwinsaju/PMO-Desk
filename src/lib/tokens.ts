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
 * Default-theme, LIGHT values. Dark / Deloitte variants are CSS-only (see the
 * attribute override blocks in tokens.css); for the brand palette itself use
 * `brandPalette` below.
 */
export const colors = {
  neutral: {
    0: "#ffffff",
    25: "#fbfbfa",
    50: "#f4f5f7",
    100: "#eceef1",
    150: "#e4e7ec",
    200: "#d6dae1",
    300: "#bfc5cf",
    400: "#a4acb9",
    500: "#858e9d",
    600: "#626b7a",
    700: "#464d5a",
    800: "#2a303a",
    900: "#14171c",
    950: "#0b0d11",
  },
  surface: "#fbfbfa",
  surfaceElevated: "#ffffff",
  border: "rgba(20,24,34,.09)",
  line: "rgba(20,24,34,.09)",
  lineStrong: "rgba(20,24,34,.12)",
  ink: "#14171c",
  inkSoft: "#464d5a",
  inkMuted: "#626b7a",
  inkFaint: "#858e9d",
  inkInverse: "#ffffff",
  glass: "rgba(255,255,255,.62)",
  glassEdge: "rgba(255,255,255,.7)",
  win: "rgba(251,251,250,.9)",
  pop: "rgba(255,255,255,.86)",
  card: "rgba(255,255,255,.7)",
  field: "rgba(255,255,255,.85)",
  chip: "rgba(20,24,34,.05)",
  chipStrong: "rgba(20,24,34,.09)",
  scrim: "rgba(14,16,28,.32)",
  accent: {
    50: "#eaf3f1",
    100: "#d2e6e1",
    200: "#a7ccc3",
    300: "#79b0a4",
    400: "#4f8f82",
    500: "#2f7367",
    600: "#1f6f5e",
    700: "#1e4b44",
    800: "#163832",
    900: "#0f2723",
  },
  accentDefault: "#1f6f5e",
  accentContrast: "#ffffff",
  accentInk: "#1f6f5e",
  amber: "#8a5a07",
  red: "#b4372d",
  success: "#17785a",
  info: "#2563b8",
} as const;

/**
 * Deloitte brand palette (June 2025 refresh). The ONLY colors Deloitte mode
 * may use, besides the supplemental status amber/red. Mirrors the overrides
 * under `:root[data-brand="deloitte"]` in tokens.css.
 */
export const brandPalette = {
  green: "#86bc25",
  black: "#000000",
  neon: "#86eb22",
  blue: "#00a3e0",
  lightBlue: "#a0dcff",
  darkBlue: "#005587",
  darkGray: "#282728",
  gray: "#e6e6e6",
  brightLime: "#b7e320",
  mid: "#63c631",
  sky: "#3fc3ec",
} as const;

/** Pixel values of the DEFAULT radius tiers — matches `--radius-*` in tokens.css. */
export const radius = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  "2xl": 20,
  "3xl": 28,
  surface: 24,
  card: 18,
  control: 12,
  chip: 9999,
  tile: 14,
  bar: 9999,
  orb: 9999,
  window: 24,
  pill: 9999,
} as const;

/** Deloitte-mode radius tiers (squarer) — matches the brand override block. */
export const radiusBrand = {
  surface: 14,
  card: 10,
  control: 8,
  chip: 6,
  tile: 8,
  bar: 12,
  orb: 8,
  seg: 10,
  segItem: 7,
} as const;

/** Matches the `--shadow-*` values in tokens.css, with `--sh` resolved to its light default. */
export const shadow = {
  floatSm: "0 8px 20px -8px rgba(34,40,80,.3), 0 2px 6px rgba(30,30,60,.08)",
  float: "0 18px 40px -14px rgba(34,40,80,.3), 0 2px 8px rgba(30,30,60,.08)",
  floatLg: "0 30px 60px -18px rgba(34,40,80,.3), 0 4px 14px rgba(30,30,60,.1)",
} as const;

/** Motion constants shared with CSS (`--ease-*`, `--dur-*`). Durations in ms. */
export const motionTokens = {
  easeSpring: "cubic-bezier(.34,1.5,.64,1)",
  easeSmooth: "cubic-bezier(.22,.9,.28,1)",
  durFast: 200,
  durBase: 350,
  durSlow: 550,
} as const;

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
  insets: { side: 12, top: 88, bottom: 96 },
} as const;
