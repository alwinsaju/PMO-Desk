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
  /** Folder picker over the main window; null when cancelled. */
  chooseFolder?: () => Promise<string | null>;
  /** Tasks Run form helpers (the shell supplies the folders; the page names no path). */
  files?: {
    newestDownload: (want: {
      extensions: string[];
      prefix?: string;
    }) => Promise<{ name: string; mtimeMs: number; size: number } | null>;
    readDownload: (
      name: string,
      extensions: string[],
    ) => Promise<{ name: string; data: Uint8Array } | null>;
    choose: (extensions: string[]) => Promise<{ name: string; data: Uint8Array } | null>;
  };
  /** Settings > Data and About: show the data folder, start a downloaded installer. */
  platform?: {
    openDataFolder: () => Promise<boolean>;
    openInstaller: (name: string) => Promise<boolean>;
  };
  /** The Dashboard export: capture a rectangle of the window as PNG bytes, then save a picture or PDF. */
  view?: {
    capture: (rect: {
      x: number;
      y: number;
      width: number;
      height: number;
    }) => Promise<Uint8Array | null>;
    save: (
      format: "png" | "pdf",
      name: string,
      png: Uint8Array,
    ) => Promise<string | null>;
  };
}

declare global {
  interface Window {
    aiOsDesktop?: AiOsDesktopBridge;
  }
}

export function getDesktopBridge(): AiOsDesktopBridge | undefined {
  return typeof window === "undefined" ? undefined : window.aiOsDesktop;
}
