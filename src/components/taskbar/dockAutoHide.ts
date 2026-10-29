// The dock's auto-hide, as plain logic (no React, no DOM) so it can be tested with fake
// timers. It stays up while the pointer or keyboard focus is on it, while one of its
// menus is open or a tile is being dragged; otherwise it slides away after a short
// grace period, and comes back as soon as the pointer reaches the top edge.

/** How long the pointer may be away before the dock hides (a quick slip does not hide it). */
export const HIDE_DELAY_MS = 450;
/** How long the dock stays up after the app opens, so people see where it is. */
export const INTRO_MS = 2500;

export interface DockFacts {
  pointerInside: boolean;
  /** Keyboard focus (not the leftover focus of a mouse click). */
  focusInside: boolean;
  menuOpen: boolean;
  dragging: boolean;
}

export const keepsDockOpen = (facts: DockFacts): boolean =>
  facts.pointerInside || facts.focusInside || facts.menuOpen || facts.dragging;

export interface DockAutoHide {
  /** Begins the intro: the dock hides after `INTRO_MS` unless something keeps it open. */
  start: () => void;
  stop: () => void;
  pointer: (inside: boolean) => void;
  focus: (inside: boolean) => void;
}

export interface DockAutoHideOptions {
  onChange: (shown: boolean) => void;
  /** Read when the grace period ends: the facts only the DOM knows. */
  outside: () => Pick<DockFacts, "menuOpen" | "dragging">;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export function createDockAutoHide({
  onChange,
  outside,
  setTimer = (run, ms) => setTimeout(run, ms),
  clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: DockAutoHideOptions): DockAutoHide {
  let timer: unknown = null;
  let pointerInside = false;
  let focusInside = false;
  let shown = true;

  const emit = (next: boolean) => {
    if (next === shown) return;
    shown = next;
    onChange(next);
  };
  const clear = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const facts = (): DockFacts => ({ pointerInside, focusInside, ...outside() });
  const schedule = (ms: number) => {
    clear();
    timer = setTimer(() => {
      timer = null;
      if (keepsDockOpen(facts())) schedule(HIDE_DELAY_MS);
      else emit(false);
    }, ms);
  };
  const settle = (inside: boolean) => {
    if (inside) {
      clear();
      emit(true);
    } else {
      schedule(HIDE_DELAY_MS);
    }
  };

  return {
    start: () => schedule(INTRO_MS),
    stop: clear,
    pointer: (inside) => {
      pointerInside = inside;
      settle(inside || focusInside);
    },
    focus: (inside) => {
      focusInside = inside;
      settle(inside || pointerInside);
    },
  };
}
