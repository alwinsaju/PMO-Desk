// A modal dialog opening is announced here so that anything transient that is
// open at that moment (tooltips, popovers) can close itself instead of staying
// on top of the dialog. Pure: the React side is useCloseOnModalOpen.ts.

type Listener = () => void;

const listeners = new Set<Listener>();

/** A dialog takes focus as it opens, and focus opens a tooltip on its first focusable
 *  control. For this long after a modal opens, tooltips refuse to open. */
export const MODAL_OPEN_GRACE_MS = 400;

let lastOpenedAt = Number.NEGATIVE_INFINITY;

export function announceModalOpened(now: number = Date.now()): void {
  lastOpenedAt = now;
  for (const listener of [...listeners]) listener();
}

/** True while a modal opened less than `MODAL_OPEN_GRACE_MS` ago. */
export function isWithinModalOpenGrace(now: number = Date.now()): boolean {
  return now - lastOpenedAt < MODAL_OPEN_GRACE_MS;
}

/** Returns the unsubscribe function. */
export function onModalOpened(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
