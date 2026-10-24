import { lazy, memo } from "react";
import type { AppComponent } from "./types";

const registry = new Map<string, AppComponent>();
const loaders = new Map<string, () => Promise<unknown>>();

/**
 * Register an app under a stable `appId`. Call this once at module scope in
 * the app's own file (e.g. `notes-app/index.ts`), then add ONE side-effect
 * import for that module to `src/components/apps/index.ts` so the
 * registration actually runs. `appId` is also what callers pass to
 * `windowStore.openWindow(appId, options)`.
 *
 * The component is wrapped in `memo`: a window re-renders for focus/drag/
 * resize bookkeeping, and without this every one of those re-rendered the
 * whole app tree inside it.
 */
export function registerApp(appId: string, component: AppComponent): void {
  if (registry.has(appId)) {
    console.warn(`[app-registry] "${appId}" is already registered — overwriting.`);
  }
  registry.set(appId, memo(component));
}

/**
 * Like `registerApp`, but the app's code is NOT part of the desktop's first
 * bundle: `loader` is a dynamic import that resolves to `{ default: App }`.
 * The window shows a brief loading state (Window.tsx supplies the Suspense
 * boundary) the first time the app opens; `preloadApps()` fetches every
 * lazy app in the background once the desktop is idle, so by the time the
 * user clicks the dock the chunk is normally already in the cache.
 */
export function registerLazyApp(
  appId: string,
  loader: () => Promise<{ default: AppComponent }>,
): void {
  if (registry.has(appId)) {
    console.warn(`[app-registry] "${appId}" is already registered — overwriting.`);
  }
  registry.set(appId, memo(lazy(loader)));
  loaders.set(appId, loader);
}

/** Starts downloading a lazy app's code (no-op for eager apps). */
export function preloadApp(appId: string): void {
  void loaders
    .get(appId)?.()
    .catch(() => {
      // A failed prefetch is retried by the real load when the app opens.
    });
}

/** Prefetches every lazy app, one after another so the network and the main
 *  thread are never hit by all of them at once. Safe to call repeatedly. */
export function preloadApps(order?: readonly string[]): void {
  const ids = [...(order ?? []), ...loaders.keys()].filter(
    (id, index, all) => all.indexOf(id) === index && loaders.has(id),
  );
  let index = 0;
  const next = () => {
    const id = ids[index++];
    if (id === undefined) return;
    preloadApp(id);
    setTimeout(next, 150);
  };
  next();
}

/** Used by Window.tsx to resolve a window's content. Returns `undefined` if
 *  nothing registered itself under that appId (e.g. its side-effect import
 *  is missing from `src/components/apps/index.ts`). */
export function getAppComponent(appId: string): AppComponent | undefined {
  return registry.get(appId);
}
