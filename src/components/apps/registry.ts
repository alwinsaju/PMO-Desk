import type { AppComponent } from "./types";

const registry = new Map<string, AppComponent>();

/**
 * Register an app under a stable `appId`. Call this once at module scope in
 * the app's own file (e.g. `notes-app/index.tsx`), then add ONE side-effect
 * import for that module to `src/components/apps/index.ts` so the
 * registration actually runs. `appId` is also what callers pass to
 * `windowStore.openWindow(appId, options)`.
 */
export function registerApp(appId: string, component: AppComponent): void {
  if (registry.has(appId)) {
    console.warn(`[app-registry] "${appId}" is already registered — overwriting.`);
  }
  registry.set(appId, component);
}

/** Used by Window.tsx to resolve a window's content. Returns `undefined` if
 *  nothing registered itself under that appId (e.g. its side-effect import
 *  is missing from `src/components/apps/index.ts`). */
export function getAppComponent(appId: string): AppComponent | undefined {
  return registry.get(appId);
}
