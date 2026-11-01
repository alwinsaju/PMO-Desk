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

/** Rows that get the staggered `anim-row` entrance. Later rows appear at once: a long
 *  list must not wait, and rows below the fold gain nothing from animating. */
export const ROW_ENTER_MAX = 12;
export const ROW_ENTER_STEP_MS = 18;

/** `anim-row` for the first ROW_ENTER_MAX rows of a list, nothing after that. */
export function rowEnterClass(index: number): string | undefined {
  return index >= 0 && index < ROW_ENTER_MAX ? "anim-row" : undefined;
}

/** Stagger for `rowEnterClass`; pair the two on the same element. */
export function rowEnterStyle(index: number): { animationDelay: string } | undefined {
  return rowEnterClass(index)
    ? { animationDelay: `${Math.floor(index) * ROW_ENTER_STEP_MS}ms` }
    : undefined;
}

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

/**
 * Spring-in / quick-out pair for the "weighty" overlays — Popover, DropdownMenu,
 * ContextMenu (`pop-in`/`pop-out`: scale .92 + 8px drop, 450ms spring) and
 * Dialog content (`dialog-in`/`dialog-out`: scale .94 + 16px rise, 550ms
 * spring). Same Radix `data-state` contract as `overlayEnter`/`overlayExit`
 * (a real `@keyframes`, so Radix delays unmount until the close finishes).
 * Tooltips keep the calmer `overlayEnter`. Under `prefers-reduced-motion`
 * globals.css redefines these keyframes as a plain fade.
 */
export const popEnter =
  "data-[state=open]:[animation:pop-in_450ms_var(--ease-spring)_forwards]";
export const popExit =
  "data-[state=closed]:[animation:pop-out_140ms_var(--ease-exit)_forwards]";
export const dialogEnter =
  "data-[state=open]:[animation:dialog-in_550ms_var(--ease-spring)_forwards]";
export const dialogExit =
  "data-[state=closed]:[animation:dialog-out_160ms_var(--ease-exit)_forwards]";

/**
 * Entrance-only counterpart to `overlayEnter`, for the one Radix part that
 * keys its Presence-driven mount off `data-state="active"|"inactive"`
 * instead of `"open"|"closed"` — Tabs' `Content` (see
 * `src/components/ui/Tabs.tsx`). Reuses the exact same `overlay-in`
 * keyframe as `overlayEnter` (same fade + settle), just matched to Tabs'
 * own attribute value, so a tab's content arrives with the same "weight"
 * as every other overlay in the kit.
 *
 * No `tabContentExit` counterpart: unlike a popover/menu/dialog, switching
 * tabs mounts the newly-selected panel and unmounts the previous one in
 * the same instant, and both panels are plain block boxes in normal flow
 * — animating the outgoing one out over even 120ms would leave both
 * visible at once and stack/jump instead of cross-fading cleanly. So the
 * outgoing panel disappears immediately, same as before this existed, and
 * only the incoming one gets a soft entrance. Radix's own Presence
 * suppresses this animation for whichever tab is already active at the
 * moment the whole Tabs tree first mounts (see `TabsContent`'s internal
 * `isMountAnimationPreventedRef`), so this never plays as an unwanted
 * flash on first paint — only on an actual switch.
 */
export const tabContentEnter =
  "data-[state=active]:[animation:overlay-in_160ms_var(--ease-entrance)_forwards]";
