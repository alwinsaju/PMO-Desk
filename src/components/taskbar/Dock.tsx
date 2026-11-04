"use client";

import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DragEvent } from "react";
import { motion } from "motion/react";
import { PlusIcon, type Icon } from "@phosphor-icons/react";
import { useShallow } from "zustand/react/shallow";
import { appCatalog, appIcons } from "@/components/app-store/appCatalog";
import { runAppPrimaryAction } from "@/components/app-store/appActions";
import { useWindowStore } from "@/components/window-manager";
import { useTitleSuffixes } from "@/components/window-manager/titleSuffixStore";
import { titleWithSuffix } from "@/components/window-manager/windowTitles";
import { Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";
import { springSnappy } from "@/lib/motion";
import { usePreferences } from "@/lib/preferences/preferencesStore";
import { AppMenu } from "./AppMenu";
import { createDockAutoHide } from "./dockAutoHide";
import { dockCapacity, splitDockItems } from "./dockOverflow";
import { DockTile, dockTileClassName, type TileRunState } from "./DockTile";
import { builtInAppIds, builtInApps } from "./pinnedApps";
import { launchBuiltInApp } from "./launchBuiltInApp";
import { useDockBadgeStore } from "./dockBadgeStore";
import { startSessionRestore } from "./sessionRestore";
import { APP_DRAG_MIME_TYPE, usePinnedAppsStore } from "./pinnedAppsStore";
import {
  appIdForWindow,
  buildTaskbarItems,
  defaultPinnedIds,
  isDefaultPinnedIds,
  showAppStoreShortcut,
  tileClickAction,
} from "./taskbarLayout";

/** Everything the dock needs to draw and launch one app, whether it is a
 *  built-in or an App Store catalog entry. */
interface TaskbarApp {
  label: string;
  icon: Icon;
  launch: () => void;
}

// Every app that can have a taskbar tile, keyed by id (built-in ids and
// catalog ids share one namespace). Built once at module scope — both
// sources are static data.
const taskbarApps = new Map<string, TaskbarApp>();
for (const app of builtInApps) {
  taskbarApps.set(app.id, {
    label: app.title,
    icon: app.icon,
    launch: () => void launchBuiltInApp(app.id),
  });
}
for (const app of appCatalog) {
  taskbarApps.set(app.id, {
    label: app.name,
    icon: appIcons[app.icon],
    launch: () => runAppPrimaryAction(app),
  });
}

// A real web app opens as the generic "web-app" window, so its window is
// matched back to its catalog entry by URL (see `appIdForWindow`).
const appIdByUrl = new Map<string, string>();
for (const app of appCatalog) if (app.url) appIdByUrl.set(app.url, app.id);
const knownAppIds: ReadonlySet<string> = new Set(taskbarApps.keys());

// "app-store" is a built-in like any other — the "+" button below opens it
// even if the user has unpinned its tile. Removing it from `builtInApps`
// would be a bug, not a layout choice, hence the `!`.
const openAppStore = taskbarApps.get("app-store")!.launch;

/** Raises (and un-minimizes) the topmost open window of an app — what
 *  clicking a temporary tile does, since that tile exists BECAUSE a window
 *  is open. Falls back to launching if the window closed in the meantime. */
function focusAppWindow(appId: string) {
  const { windows, restoreWindow } = useWindowStore.getState();
  const topmost = Object.values(windows)
    .filter((w) => appIdForWindow(w, appIdByUrl, knownAppIds) === appId)
    .sort((a, b) => a.zIndex - b.zIndex)
    .at(-1);
  if (topmost) restoreWindow(topmost.id);
  else taskbarApps.get(appId)?.launch();
}

/** A pinned tile's click: minimises the app's focused window, restores a
 *  minimised one, and only opens a new window when there is neither (so it
 *  never piles windows up). "New window" in the tile's menu forces one. */
function clickPinnedTile(appId: string) {
  const { windows, restoreWindow, minimizeWindow } = useWindowStore.getState();
  const own = Object.values(windows).filter(
    (w) => appIdForWindow(w, appIdByUrl, knownAppIds) === appId,
  );
  const action = tileClickAction(own);
  if (action.type === "minimize") minimizeWindow(action.windowId);
  else if (action.type === "restore") restoreWindow(action.windowId);
  else taskbarApps.get(appId)?.launch();
}

/** Dock menu: minimise every window (one store update, so nothing is refocused). */
const showDesktop = () => useWindowStore.getState().minimizeAllWindows();
/** Dock menu: put every visible window back on a fresh cascade (one store update). */
const tidyWindows = () => useWindowStore.getState().tidyWindows();

const subscribeNever = () => () => {};
const WIDE_SCREEN = 1920;

function subscribeResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/**
 * Top-centered floating pill dock — the app launcher/taskbar. A plain
 * launcher only: the command bar, AI cursor, and presence avatars are a
 * separate, later workstream (the AI Agent Layer) and don't belong here.
 *
 * Always visible on the home page (no app window showing); once an app is open it
 * auto-hides like the macOS dock (dockAutoHide.ts): it slides up out of view when the
 * pointer is not on it (after a short grace period; an open menu, keyboard focus or a
 * tile drag keeps it up) and returns when the pointer reaches the top edge, where a
 * small handle marks it while it is away.
 *
 * A 60px frosted-glass pill (`glass rounded-surface`) at the `z-chrome`
 * layer, mounted as a sibling of `<WindowManager />` from Desktop.tsx, of
 * 46px tiles that morph square -> circle on hover (see DockTile.tsx). The tiles are USER-EDITABLE: one
 * `DockTile` per id in `pinnedAppsStore`'s ordered list (a fresh taskbar is
 * every built-in app, see pinnedApps.ts; the user can unpin any of them, pin
 * any built-in or installed App Store app, drag tiles to reorder, and reset
 * to default — all via a tile's right-click menu, the App Menu, or drag).
 * After the pinned tiles come TEMPORARY tiles for any app with an open
 * window that isn't pinned (they vanish when the window closes), then a
 * divider and two trailing icon buttons: the App Menu (every installed app
 * — see AppMenu.tsx) and the "+" that's always been a straight shortcut to
 * the App Store itself.
 *
 * Each tile shows whether its app is running: an accent dot while it has a
 * visible window, a grey dot when every window is minimized. Clicking a PINNED
 * tile whose app has a minimized window restores and focuses that window
 * instead of opening another; otherwise a click opens a new window as ever.
 *
 * A tile can carry a small count badge (`dockBadgeStore`, keyed by app id): the
 * PMO reminder poller sets the "pmo-todo" one to the number of items needing
 * attention. Badges are display-only and never touch the pinned layout.
 *
 * Also a drop target for app-id drags (see pinnedAppsStore.ts's
 * `APP_DRAG_MIME_TYPE`): dragging an `AppMenuEntry` or one of this dock's own
 * tiles onto another pinned tile drops it before/after that tile (an accent
 * bar shows which side), and onto anywhere else on the pill pins it at the
 * end (a no-op for an already-pinned tile). The pill gets a ring highlight
 * while a recognized drag is over it.
 */
export function Dock() {
  const pinnedIds = usePinnedAppsStore((s) => s.pinnedIds);
  const pinApp = usePinnedAppsStore((s) => s.pinApp);
  const unpinApp = usePinnedAppsStore((s) => s.unpinApp);
  const placeApp = usePinnedAppsStore((s) => s.placeApp);
  const resetPinnedApps = usePinnedAppsStore((s) => s.resetPinnedApps);
  const openAppIds = useWindowStore(
    useShallow((s) =>
      Object.values(s.windows).flatMap((w) => {
        const id = appIdForWindow(w, appIdByUrl, knownAppIds);
        return id ? [id] : [];
      }),
    ),
  );
  // The subset of those with at least one NON-minimized window — what
  // separates an "open" dot from a "minimized" one.
  const visibleAppIds = useWindowStore(
    useShallow((s) =>
      Object.values(s.windows).flatMap((w) => {
        if (w.isMinimized) return [];
        const id = appIdForWindow(w, appIdByUrl, knownAppIds);
        return id ? [id] : [];
      }),
    ),
  );
  const badges = useDockBadgeStore((s) => s.badges);
  const meanings = useDockBadgeStore((s) => s.meanings);
  // Each open window as "appId<NUL>title", so a tile's tooltip can list them.
  const windowEntries = useWindowStore(
    useShallow((s) =>
      Object.values(s.windows).flatMap((w) => {
        const id = appIdForWindow(w, appIdByUrl, knownAppIds);
        return id ? [`${id}\u0000${w.title}`] : [];
      }),
    ),
  );
  const titleSuffixes = useTitleSuffixes((s) => s.suffixes);
  const titlesOf = (appId: string): string[] =>
    windowEntries
      .filter((entry) => entry.startsWith(`${appId}\u0000`))
      .map((entry) =>
        titleWithSuffix(entry.slice(appId.length + 1), titleSuffixes[appId]),
      );
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [dropHint, setDropHint] = useState<{ id: string; after: boolean } | null>(null);
  const draggingTileId = useRef<string | null>(null);

  // The dock is server-rendered (Desktop.tsx is a Server Component) and the
  // store hydrates the user's saved layout from localStorage the moment it's
  // created in the browser — so the first client render must show the default
  // taskbar (what the server rendered) and only then switch to the saved
  // one, or React reports a hydration mismatch for anyone who customized it.
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const settled = useRef(false);
  useEffect(() => {
    settled.current = hydrated;
  }, [hydrated]);
  // "Reopen last session's apps" (q-8): once per page load, after the saved preferences arrive.
  useEffect(() => {
    startSessionRestore();
  }, []);

  // Settings > "Show dock labels". Like the pinned layout it only applies after hydration,
  // so the first client render matches the server-rendered dock.
  const showLabelsPref = usePreferences((s) => s.showDockLabels);
  const showLabels = hydrated && showLabelsPref;
  const hasVisibleWindows = useWindowStore((s) =>
    Object.values(s.windows).some((w) => !w.isMinimized),
  );

  // Auto-hide, like the macOS dock: it slides away when the pointer is not on it and
  // returns when the pointer reaches the top edge (see dockAutoHide.ts).
  const navRef = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(true);
  const [autoHide] = useState(() =>
    createDockAutoHide({
      onChange: setShown,
      outside: () => ({
        menuOpen: navRef.current?.querySelector('[data-state="open"]') != null,
        dragging: draggingTileId.current !== null,
      }),
    }),
  );
  useEffect(() => {
    autoHide.start();
    return autoHide.stop;
  }, [autoHide]);
  // The home page keeps the dock up; it only hides once an app window is showing.
  const homePage = !useWindowStore((s) =>
    Object.values(s.windows).some((w) => !w.isMinimized),
  );
  useEffect(() => autoHide.desktopClear(homePage), [autoHide, homePage]);

  const effectivePinnedIds = hydrated ? pinnedIds : defaultPinnedIds(builtInAppIds);
  // Drop ids that no longer resolve to an app — defensive only (a stale id
  // from a since-edited catalog); nothing here removes apps at runtime.
  const allItems = buildTaskbarItems(
    effectivePinnedIds.filter((id) => taskbarApps.has(id)),
    openAppIds,
  );
  const viewportWidth = useSyncExternalStore(
    subscribeResize,
    () => window.innerWidth,
    () => WIDE_SCREEN,
  );
  // On a narrow screen the tail of the dock moves into the App Menu ("more apps").
  const { shown: items, hidden: hiddenItems } = splitDockItems(
    allItems,
    dockCapacity(viewportWidth, showLabels),
    new Set(openAppIds),
  );
  const canReset = !isDefaultPinnedIds(effectivePinnedIds, builtInAppIds);

  function runStateOf(appId: string): TileRunState {
    if (visibleAppIds.includes(appId)) return "open";
    return openAppIds.includes(appId) ? "minimized" : "none";
  }

  function clearDragState() {
    setIsDropTarget(false);
    setDropHint(null);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    // `dataTransfer.getData` is only readable on drop, but `.types` is
    // readable throughout the drag — exactly what's needed to decide
    // whether THIS drag is one we accept before the user releases it.
    if (!event.dataTransfer.types.includes(APP_DRAG_MIME_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = draggingTileId.current ? "move" : "copy";
    setIsDropTarget(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    // `dragleave` also fires when the pointer moves between this pill's own
    // children; only clear when it actually left the pill.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    clearDragState();
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    const id = event.dataTransfer.getData(APP_DRAG_MIME_TYPE);
    clearDragState();
    if (!id) return;
    event.preventDefault();
    pinApp(id);
  }

  function handleTileDragOver(event: DragEvent<HTMLDivElement>, id: string) {
    if (!event.dataTransfer.types.includes(APP_DRAG_MIME_TYPE)) return;
    if (draggingTileId.current === id) {
      setDropHint(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setDropHint({ id, after: event.clientX > rect.left + rect.width / 2 });
  }

  function handleTileDrop(event: DragEvent<HTMLDivElement>, targetId: string) {
    const id = event.dataTransfer.getData(APP_DRAG_MIME_TYPE);
    const after = dropHint?.id === targetId ? dropHint.after : false;
    clearDragState();
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    placeApp(id, targetId, after);
  }

  return (
    <nav
      ref={navRef}
      aria-label="App dock"
      onPointerEnter={() => autoHide.pointer(true)}
      onPointerLeave={() => autoHide.pointer(false)}
      onFocus={(event) => {
        // Only keyboard focus keeps the dock up; a clicked tile keeps focus without it.
        if (event.target.matches(":focus-visible")) autoHide.focus(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          autoHide.focus(false);
        }
      }}
      className="pointer-events-none absolute top-0 left-1/2 z-[var(--z-chrome)] -translate-x-1/2 pt-4"
    >
      {/* The hover area along the top edge: it brings the dock back, and while the
          dock is away a small handle shows where it is. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-auto absolute top-0 right-0 left-0",
          shown ? "h-5" : "h-2",
        )}
      />
      <div
        aria-hidden
        className={cn(
          "bg-line-strong pointer-events-none absolute top-1 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full",
          "ease-standard transition-opacity duration-200",
          shown ? "opacity-0" : "opacity-70",
        )}
      />
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          // With labels the pill is a little taller (still clear of the window insets) so
          // the name fits under the 46px tile.
          "glass rounded-surface flex items-center gap-1.5 px-2.5",
          showLabels ? "h-[68px]" : "h-dock",
          "ease-standard transition-[box-shadow,transform,opacity] duration-300",
          shown
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-[calc(100%+1.5rem)] opacity-0",
          isDropTarget && "ring-focus ring-offset-surface ring-2 ring-offset-2",
        )}
      >
        {items.map(({ id, pinned }, index) => {
          const app = taskbarApps.get(id)!;
          // Apps that are only here because a window is open sit after a thin
          // divider, apart from the pinned ones.
          const startsTemporary = !pinned && index > 0 && items[index - 1].pinned;
          return (
            <Fragment key={id}>
              {startsTemporary && (
                <div aria-hidden className="bg-line mx-0.5 h-[18px] w-px" />
              )}
              {/* Newly-added tiles pop in rather than snapping into existence (not on
                  first paint: `settled` is false until after the first hydrated
                  render), and `layout` lets the rest of this row settle into its new
                  position smoothly when a tile is added, removed or moved. There is no
                  exit animation on removal (see AICursor.tsx's doc comment: an
                  unmount-driven `exit` isn't reliable in this project's React 19 +
                  motion setup), so a removed tile just disappears while its neighbors
                  slide over. The wrapper is also the per-tile drag-over/drop target for
                  reordering. */}
              <motion.div
                layout
                initial={settled.current ? { opacity: 0, scale: 0.5 } : false}
                animate={{ opacity: 1, scale: 1 }}
                transition={springSnappy}
                className="relative"
                onDragOver={pinned ? (event) => handleTileDragOver(event, id) : undefined}
                onDrop={pinned ? (event) => handleTileDrop(event, id) : undefined}
              >
                <DockTile
                  appId={id}
                  label={app.label}
                  icon={app.icon}
                  onClick={pinned ? () => clickPinnedTile(id) : () => focusAppWindow(id)}
                  onNewWindow={app.launch}
                  running={runStateOf(id)}
                  pinned={pinned}
                  onTogglePinned={() => (pinned ? unpinApp(id) : pinApp(id))}
                  onResetTaskbar={resetPinnedApps}
                  canReset={canReset}
                  onShowDesktop={showDesktop}
                  onTidyWindows={tidyWindows}
                  hasVisibleWindows={hasVisibleWindows}
                  showLabel={showLabels}
                  badge={badges[id]}
                  badgeMeaning={meanings[id]}
                  windowTitles={titlesOf(id)}
                  dragProps={
                    pinned
                      ? {
                          draggable: true,
                          onDragStart: (event) => {
                            event.dataTransfer.setData(APP_DRAG_MIME_TYPE, id);
                            event.dataTransfer.effectAllowed = "copyMove";
                            draggingTileId.current = id;
                          },
                          onDragEnd: () => {
                            draggingTileId.current = null;
                            clearDragState();
                          },
                        }
                      : undefined
                  }
                />
                {dropHint?.id === id && (
                  <span
                    aria-hidden
                    className={cn(
                      "bg-accent-ink pointer-events-none absolute top-1 bottom-1 w-0.5 rounded-full",
                      dropHint.after ? "-right-[4px]" : "-left-[4px]",
                    )}
                  />
                )}
              </motion.div>
            </Fragment>
          );
        })}

        {items.length > 0 && (
          <div aria-hidden className="bg-line-strong mx-1 h-[26px] w-px" />
        )}

        <div
          role="group"
          aria-label="Launchers"
          className="bg-chip/70 border-line flex items-center gap-1 rounded-[calc(var(--radius-tile)+4px)] border p-[3px]"
        >
          <AppMenu hiddenCount={hiddenItems.length} />

          {showAppStoreShortcut(items) && (
            <Tooltip label="Get more apps" side="bottom" sideOffset={16}>
              <button
                type="button"
                aria-label="Open App Store"
                onClick={openAppStore}
                className={dockTileClassName}
              >
                <PlusIcon size={23} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </nav>
  );
}
