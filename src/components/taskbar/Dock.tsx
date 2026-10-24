"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DragEvent } from "react";
import { motion } from "motion/react";
import { PlusIcon, type Icon } from "@phosphor-icons/react";
import { useShallow } from "zustand/react/shallow";
import { appCatalog, appIcons } from "@/components/app-store/appCatalog";
import { runAppPrimaryAction } from "@/components/app-store/appActions";
import { useWindowStore } from "@/components/window-manager";
import { Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";
import { springSnappy } from "@/lib/motion";
import { AppMenu } from "./AppMenu";
import { DockTile, dockTileClassName, type TileRunState } from "./DockTile";
import { builtInAppIds, builtInApps } from "./pinnedApps";
import { useDockBadgeStore } from "./dockBadgeStore";
import { APP_DRAG_MIME_TYPE, usePinnedAppsStore } from "./pinnedAppsStore";
import {
  appIdForWindow,
  buildTaskbarItems,
  defaultPinnedIds,
  isDefaultPinnedIds,
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
  const IconGlyph = app.icon;
  taskbarApps.set(app.id, {
    label: app.title,
    icon: app.icon,
    launch: () =>
      useWindowStore.getState().openWindow(app.id, {
        title: app.title,
        icon: <IconGlyph />,
      }),
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

/** If `appId` has a MINIMIZED window, brings the topmost one back (restore +
 *  focus) and returns true. A pinned tile's click uses this so it doesn't
 *  pile a new window on top of one the user just tucked away; with no
 *  minimized window it returns false and the click launches as before. */
function restoreMinimizedAppWindow(appId: string): boolean {
  const { windows, restoreWindow } = useWindowStore.getState();
  const minimized = Object.values(windows)
    .filter((w) => w.isMinimized && appIdForWindow(w, appIdByUrl, knownAppIds) === appId)
    .sort((a, b) => a.zIndex - b.zIndex)
    .at(-1);
  if (!minimized) return false;
  restoreWindow(minimized.id);
  return true;
}

const subscribeNever = () => () => {};

/**
 * Top-centered floating pill dock — the app launcher/taskbar. A plain
 * launcher only: the command bar, AI cursor, and presence avatars are a
 * separate, later workstream (the AI Agent Layer) and don't belong here.
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

  const effectivePinnedIds = hydrated ? pinnedIds : defaultPinnedIds(builtInAppIds);
  // Drop ids that no longer resolve to an app — defensive only (a stale id
  // from a since-edited catalog); nothing here removes apps at runtime.
  const items = buildTaskbarItems(
    effectivePinnedIds.filter((id) => taskbarApps.has(id)),
    openAppIds,
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
      aria-label="App dock"
      className="absolute top-4 left-1/2 z-[var(--z-chrome)] -translate-x-1/2"
    >
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "glass rounded-surface h-dock flex items-center gap-1.5 px-2.5",
          "ease-standard transition-[box-shadow] duration-150",
          isDropTarget && "ring-focus ring-offset-surface ring-2 ring-offset-2",
        )}
      >
        {items.map(({ id, pinned }) => {
          const app = taskbarApps.get(id)!;
          return (
            // Newly-added tiles pop in rather than snapping into existence
            // (not on first paint — `settled` is false until after the first
            // hydrated render), and `layout` lets the rest of this row settle
            // into its new position smoothly when a tile is added, removed or
            // moved — no exit animation on removal (see AICursor.tsx's doc
            // comment: an unmount-driven `exit` isn't reliable in this
            // project's React 19 + motion setup), so a removed tile just
            // disappears while its neighbors slide over. The wrapper is also
            // the per-tile drag-over/drop target for reordering.
            <motion.div
              key={id}
              layout
              initial={settled.current ? { opacity: 0, scale: 0.5 } : false}
              animate={{ opacity: 1, scale: 1 }}
              transition={springSnappy}
              className="relative"
              onDragOver={pinned ? (event) => handleTileDragOver(event, id) : undefined}
              onDrop={pinned ? (event) => handleTileDrop(event, id) : undefined}
            >
              <DockTile
                label={app.label}
                icon={app.icon}
                onClick={
                  pinned
                    ? () => {
                        if (!restoreMinimizedAppWindow(id)) app.launch();
                      }
                    : () => focusAppWindow(id)
                }
                running={runStateOf(id)}
                pinned={pinned}
                onTogglePinned={() => (pinned ? unpinApp(id) : pinApp(id))}
                onResetTaskbar={resetPinnedApps}
                canReset={canReset}
                badge={badges[id]}
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
          );
        })}

        {items.length > 0 && (
          <div aria-hidden className="bg-line-strong mx-1 h-[26px] w-px" />
        )}

        <AppMenu />

        <Tooltip label="App Store" side="bottom" sideOffset={16}>
          <button
            type="button"
            aria-label="Open App Store"
            onClick={openAppStore}
            className={dockTileClassName}
          >
            <PlusIcon size={23} />
          </button>
        </Tooltip>
      </div>
    </nav>
  );
}
