/**
 * Dark-mode persistence. There is no Settings app yet (the toggle currently
 * lives in DesktopContextMenu.tsx — see the comment there) and no
 * backend-persisted settings concept in this project, so localStorage is
 * the whole story. Absence of a stored value means "light" — this app
 * intentionally does NOT fall back to the OS's `prefers-color-scheme`, so
 * the toggle's on/off state always matches exactly what's on screen,
 * independent of the visiting device's system theme.
 *
 * The dark palette itself lives in `src/styles/tokens.css` under
 * `:root[data-theme="dark"]`. Setting/removing the `data-theme` attribute
 * on <html> is the entire mechanism — every component already reads color
 * exclusively through tokens.css's CSS variables (see that file's own
 * comments), so nothing here needs to know or care what's actually on
 * screen; it only ever touches the one attribute + one storage key.
 */

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "ai-os:theme";

/** Reads the persisted choice. Safe to call from a Server Component. */
export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    // localStorage disabled/unavailable (private browsing, etc.) — treat
    // as the default rather than throwing.
    return "light";
  }
}

/** Applies `theme` to <html> and persists the choice for next time. */
export function setTheme(theme: Theme): void {
  if (typeof document !== "undefined") {
    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Same as above — the toggle still works for the current tab, it just
    // won't survive a reload.
  }
}

/**
 * Source for the root layout's `beforeInteractive` inline script (see
 * layout.tsx). Has to be a plain string, not an import, because no module
 * scope exists yet when an inline `beforeInteractive` script runs — but
 * it's built from THEME_STORAGE_KEY above (interpolated server-side, at
 * render time) so the two can never drift apart. Runs before hydration so
 * a returning dark-mode user never sees a flash of the light theme first.
 */
export function getThemeInitScript(): string {
  return `(function(){try{if(window.localStorage.getItem(${JSON.stringify(
    THEME_STORAGE_KEY,
  )})==="dark"){document.documentElement.setAttribute("data-theme","dark");}}catch(e){}})();`;
}
