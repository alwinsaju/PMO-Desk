/**
 * Named motion presets for the `motion` package (`import ... from
 * "motion/react"`). Reach for one of these instead of inventing ad hoc
 * spring/ease values inline, so every animated moment in the app feels
 * consistent.
 *
 * The three springs are tuned for three distinct feelings:
 *  - `springSnappy` — quick settle, minimal overshoot. Press/focus feedback.
 *  - `springWindow` — soft but substantial, no bounce. Window open/close/
 *    minimize/restore. A window is a "heavy" object; it shouldn't jiggle.
 *  - `springTrailing` — loose and heavy, deliberately laggy. Reserved for a
 *    future cursor-follow effect (the AI Agent Layer's AI cursor overlay),
 *    where lagging slightly behind reads as "the agent is chasing the
 *    pointer" rather than being locked to it.
 *
 * The three eases are cubic-bezier tuples for the `ease` field of a
 * `motion` transition. They mirror the `--ease-standard` / `--ease-entrance`
 * / `--ease-exit` custom properties in `src/styles/tokens.css` — keep both
 * in sync. Use the CSS versions for plain CSS transitions/keyframes (see
 * `overlayEnter`/`overlayExit` below and the keyframes in globals.css); use
 * these tuples when animating via the `motion` library instead.
 */

import type { Transition } from "motion/react";

/** Snappy — button presses, toggle flips, focus-ring pop-ins. */
export const springSnappy: Transition = {
  type: "spring",
  stiffness: 500,
  damping: 30,
  mass: 0.9,
};

/** Soft/substantial — window open, close, minimize, restore. */
export const springWindow: Transition = {
  type: "spring",
  stiffness: 260,
  damping: 28,
  mass: 1,
};

/** Loose/heavy — reserved for a future cursor-follow / trailing effect. */
export const springTrailing: Transition = {
  type: "spring",
  stiffness: 120,
  damping: 18,
  mass: 1.4,
};

/** Default ease for most simple transitions. */
export const easeStandard = [0.4, 0, 0.2, 1] as const;

/** Decelerate — menus, tooltips, dialogs, popovers opening. */
export const easeEntrance = [0.16, 1, 0.3, 1] as const;

/** Accelerate — menus, tooltips, dialogs, popovers closing. */
export const easeExit = [0.4, 0, 1, 1] as const;

/**
 * Ready-to-spread className fragments for the open/close animation shared
 * by every Radix-based overlay primitive (Tooltip, Popover, DropdownMenu,
 * ContextMenu, Dialog content). Radix sets `data-state="open" | "closed"`
 * on these parts and keeps the node mounted until its CSS `animation`
 * finishes, so this has to be a real `@keyframes` animation (not a
 * `transition`) — see `overlay-in`/`overlay-out` in globals.css.
 *
 * Usage: `className={cn(overlayEnter, overlayExit, "...", className)}`
 */
export const overlayEnter =
  "data-[state=open]:[animation:overlay-in_160ms_var(--ease-entrance)_forwards]";
export const overlayExit =
  "data-[state=closed]:[animation:overlay-out_120ms_var(--ease-exit)_forwards]";
