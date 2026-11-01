// A modal dialog opening is announced here so that anything transient that is
// open at that moment (tooltips, popovers) can close itself instead of staying
// on top of the dialog. Pure: the React side is useCloseOnModalOpen.ts.

type Listener = () => void;

const listeners = new Set<Listener>();

export function announceModalOpened(): void {
  for (const listener of [...listeners]) listener();
}

/** Returns the unsubscribe function. */
export function onModalOpened(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
