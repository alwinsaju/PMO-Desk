// The tiny API desktop/preload.cjs exposes to the page when AI OS runs inside
// the Electron shell (window.aiOsDesktop). In a plain browser it is undefined,
// which is also how the reminder code knows which path it is on: the shell
// claims and shows reminders itself, a browser tab does it from the page.
export interface AiOsDesktopBridge {
  isDesktop: true;
  /** The user clicked a reminder: open the PMO To-Do app (on that to-do when
   *  the id is not null). Returns an unsubscribe function. */
  onOpenTodo: (callback: (todoId: string | null) => void) => () => void;
  /** Tell the shell how many items need attention (taskbar overlay, tray tip). */
  setBadge: (count: number) => void;
}

declare global {
  interface Window {
    aiOsDesktop?: AiOsDesktopBridge;
  }
}

export function getDesktopBridge(): AiOsDesktopBridge | undefined {
  return typeof window === "undefined" ? undefined : window.aiOsDesktop;
}
