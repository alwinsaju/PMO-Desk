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

export const colors = {
  neutral: {
    0: "#ffffff",
    25: "#fafafa",
    50: "#f5f5f4",
    100: "#ededeb",
    150: "#e8e8e6",
    200: "#dadad8",
    300: "#c4c4c1",
    400: "#a7a7a5",
    500: "#8a8a8c",
    600: "#6b6b6e",
    700: "#4d4d50",
    800: "#2f2f32",
    900: "#181818",
    950: "#0e0e10",
  },
  surface: "#fafafa",
  surfaceElevated: "#ffffff",
  border: "#e8e8e6",
  ink: "#181818",
  inkMuted: "#6b6b6e",
  inkFaint: "#8a8a8c",
  inkInverse: "#ffffff",
  accent: {
    50: "#eaf3f1",
    100: "#d2e6e1",
    200: "#a7ccc3",
    300: "#79b0a4",
    400: "#4f8f82",
    500: "#2f7367",
    600: "#245c50",
    700: "#1e4b44",
    800: "#163832",
    900: "#0f2723",
  },
  accentDefault: "#245c50",
  accentHover: "#1e4b44",
  accentActive: "#163832",
  accentSubtle: "#eaf3f1",
  accentContrast: "#ffffff",
} as const;

/** Pixel values — matches the `--radius-*` scale in tokens.css. */
export const radius = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  "2xl": 20,
  "3xl": 28,
  window: 16,
  control: 10,
  pill: 9999,
} as const;

/** Matches the `--shadow-float*` values in tokens.css. */
export const shadow = {
  floatSm: "0 6px 16px rgba(0,0,0,.12), 0 2px 6px rgba(0,0,0,.06)",
  float: "0 12px 32px rgba(0,0,0,.14), 0 4px 10px rgba(0,0,0,.08)",
  floatLg: "0 20px 48px rgba(0,0,0,.18), 0 8px 16px rgba(0,0,0,.10)",
} as const;

/**
 * Semantic layout sizes, in pixels. `dock` and `commandBar` are reserved
 * for the Desktop Shell & Chrome / AI Agent Layer phases — defined now so
 * every phase agrees on the same numbers before either surface exists
 * (e.g. for computing where a window should animate toward when minimized).
 */
export const sizes = {
  titlebarHeight: 44,
  dockHeight: 56,
  commandBarHeight: 52,
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

/** Window-manager behavior constants. See windowStore.ts for usage. */
export const windowDefaults = {
  size: { width: 900, height: 600 },
  minSize: { width: 360, height: 240 },
  cascadeOffset: 32,
  cascadeOrigin: { x: 120, y: 96 },
  /** Wrap the cascade after this many opens so windows don't walk off-screen. */
  cascadeWrap: 10,
} as const;
