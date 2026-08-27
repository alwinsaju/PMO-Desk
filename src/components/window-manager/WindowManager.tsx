"use client";

// Side-effect import: every registered app calls `registerApp(appId, ...)`
// when this module loads (see src/components/apps/index.ts). This has to be
// imported from somewhere that is UNAMBIGUOUSLY part of the client bundle —
// not merely imported (even transitively) from a Server Component. A bare
// side-effect import crossing the server/client boundary with nothing in
// the render tree actually referencing an export from it can get dropped by
// Next.js's client bundler, since nothing in the RSC render graph appears
// to "use" it. WindowManager is a client component that always renders, and
// it's the piece that actually needs the registry populated before it
// resolves any window's appId, so this is the right place for it.
import "@/components/apps";
import { useVisibleWindowIds } from "./windowStore";
import { Window } from "./Window";

/**
 * Renders every open, non-minimized window. This is the only place that
 * decides WHICH windows exist on screen; `Window` owns everything about
 * rendering one of them (chrome, drag/resize, and resolving its app content
 * via the app registry).
 *
 * Mount this once, positioned as a full-viewport layer above the wallpaper
 * (see Desktop.tsx) and below the future dock/command-bar chrome (which
 * will use the higher `z-[var(--z-chrome)]` layer).
 *
 * Giving this wrapper its own `position` + `z-index` establishes a new
 * stacking context, which is deliberate: every window's own dynamic
 * zIndex (100, 101, 102, ...) is only ever compared against OTHER windows
 * inside that context. From the outside, this whole layer counts as a
 * single unit at `z-window-base`, so no amount of window-focusing over a
 * long session can ever climb high enough to appear above the chrome/
 * overlay layers.
 *
 * `pointer-events-none` here is deliberate: this wrapper is full-viewport
 * even when there are zero open windows (the common case now that the
 * dock is the only launcher), and without this it would silently sit on
 * top of the wallpaper/desktop layer and swallow every click meant for it
 * — including the right-click that opens `DesktopContextMenu`. Each
 * `Window`'s own OUTER element re-enables `pointer-events-auto` so window
 * chrome/content stays fully interactive.
 */
export function WindowManager() {
  const ids = useVisibleWindowIds();

  return (
    <div className="pointer-events-none absolute inset-0 z-[var(--z-window-base)]">
      {ids.map((id) => (
        <Window key={id} id={id} />
      ))}
    </div>
  );
}
