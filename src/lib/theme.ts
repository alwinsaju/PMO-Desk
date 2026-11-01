/**
 * Appearance persistence: TWO orthogonal choices, each one attribute on
 * <html> plus one localStorage key. There is no Settings app (the toggles
 * live in the top-right SettingsMenu.tsx, which reads them via `useTheme` /
 * `useBrand`). localStorage is the source of truth (it must be readable before
 * hydration); each change is also mirrored, best effort, to the server's
 * `preferences` key so a new origin (another port) can restore it once.
 *
 *   Theme  — `data-theme="dark"`      key `ai-os:theme`   absent = light
 *   Brand  — `data-brand="deloitte"`  key `ai-os:brand`   absent = default
 *
 * This app intentionally does NOT fall back to the OS's
 * `prefers-color-scheme`, so a toggle's on/off state always matches exactly
 * what's on screen, independent of the visiting device's system theme.
 *
 * The palettes themselves live in `src/styles/tokens.css` (dark under
 * `:root[data-theme="dark"]`, Deloitte under `:root[data-brand="deloitte"]`
 * and its light/dark combinations). Setting/removing the attribute on <html>
 * is the entire mechanism — every component reads color exclusively through
 * tokens.css's CSS variables, so nothing here needs to know or care what's
 * actually on screen; it only ever touches the attributes + storage keys.
 */

import {
  fetchServerPreferences,
  mirrorPreferences,
  type PreferencesFetch,
} from "./preferencesSync.ts";

export type Theme = "light" | "dark";
export type Brand = "default" | "deloitte";

export const THEME_STORAGE_KEY = "ai-os:theme";
export const BRAND_STORAGE_KEY = "ai-os:brand";

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

/**
 * Runs a look change (dark/light, Deloitte mode) as ONE cross-fade of the whole screen
 * instead of letting hundreds of colours, shadows and the wallpaper change on their own
 * timelines. The browser snapshots the old screen, applies `change`, and fades between the
 * two snapshots on the compositor, so it stays at the display's frame rate however busy
 * the page is. While it runs, CSS transitions are switched off (`data-look-switching`,
 * globals.css) so nothing animates twice. Without the View Transitions API, or when the
 * person asked for less motion, the change is applied at once.
 */
export function withLookTransition(change: () => void): void {
  if (typeof document === "undefined") {
    change();
    return;
  }
  const doc = document as Document & {
    startViewTransition?: (update: () => void) => { finished: Promise<unknown> };
  };
  const reduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (typeof doc.startViewTransition !== "function" || reduced) {
    change();
    return;
  }
  const root = document.documentElement;
  root.setAttribute("data-look-switching", "");
  const done = () => root.removeAttribute("data-look-switching");
  try {
    doc.startViewTransition(change).finished.then(done, done);
  } catch {
    done();
    change();
  }
}

/** Applies `theme` to <html> and persists the choice for next time. */
export function setTheme(theme: Theme): void {
  persistTheme(theme);
  withLookTransition(() => writeTheme(theme));
  mirrorPreferences({ theme, brand: getStoredBrand() });
}

function writeTheme(theme: Theme): void {
  if (typeof document !== "undefined") {
    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }
  persistTheme(theme);
}

function persistTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Same as above — the toggle still works for the current tab, it just
    // won't survive a reload.
  }
}

/** Reads the persisted brand choice. Safe to call from a Server Component. */
export function getStoredBrand(): Brand {
  if (typeof window === "undefined") return "default";
  try {
    return window.localStorage.getItem(BRAND_STORAGE_KEY) === "deloitte"
      ? "deloitte"
      : "default";
  } catch {
    return "default";
  }
}

/** Applies `brand` to <html> and persists the choice for next time. */
export function setBrand(brand: Brand): void {
  persistBrand(brand);
  withLookTransition(() => writeBrand(brand));
  mirrorPreferences({ theme: getStoredTheme(), brand });
}

function writeBrand(brand: Brand): void {
  if (typeof document !== "undefined") {
    if (brand === "deloitte") {
      document.documentElement.setAttribute("data-brand", "deloitte");
    } else {
      document.documentElement.removeAttribute("data-brand");
    }
  }
  persistBrand(brand);
}

function persistBrand(brand: Brand): void {
  try {
    window.localStorage.setItem(BRAND_STORAGE_KEY, brand);
  } catch {
    // Works for the current tab, just won't survive a reload.
  }
}

function hasNoStoredValue(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === null;
  } catch {
    return false;
  }
}

/** For a fresh origin (e.g. the app moved to another port): when localStorage
 *  holds no theme / brand yet, take the one saved on the server. Never throws,
 *  and never overrides a choice this browser already has. */
export async function restoreAppearanceFromServer(
  fetchFn?: PreferencesFetch,
): Promise<void> {
  if (typeof window === "undefined") return;
  const saved = await fetchServerPreferences(fetchFn);
  if (!saved) return;
  if (
    hasNoStoredValue(THEME_STORAGE_KEY) &&
    (saved.theme === "dark" || saved.theme === "light")
  ) {
    writeTheme(saved.theme);
  }
  if (
    hasNoStoredValue(BRAND_STORAGE_KEY) &&
    (saved.brand === "deloitte" || saved.brand === "default")
  ) {
    writeBrand(saved.brand);
  }
}

/**
 * Source for the root layout's `beforeInteractive` inline script (see
 * layout.tsx). Has to be a plain string, not an import, because no module
 * scope exists yet when an inline `beforeInteractive` script runs — but
 * it's built from the storage keys above (interpolated server-side, at
 * render time) so they can never drift apart. Sets BOTH attributes
 * (`data-theme`, `data-brand`) before hydration so a returning dark-mode or
 * Deloitte-mode user never sees a flash of the other look first. Each read
 * is wrapped on its own so one failing key can't block the other.
 */
export function getThemeInitScript(): string {
  const theme = JSON.stringify(THEME_STORAGE_KEY);
  const brand = JSON.stringify(BRAND_STORAGE_KEY);
  return (
    `(function(){var d=document.documentElement;` +
    `try{if(window.localStorage.getItem(${theme})==="dark"){d.setAttribute("data-theme","dark");}}catch(e){}` +
    `try{if(window.localStorage.getItem(${brand})==="deloitte"){d.setAttribute("data-brand","deloitte");}}catch(e){}` +
    `})();`
  );
}
