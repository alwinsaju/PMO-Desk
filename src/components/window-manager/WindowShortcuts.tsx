"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { snapKey } from "./windowSnap";
import { mruOrder, stepIndex, switcherKey } from "./windowSwitch";
import { useWindowStore } from "./windowStore";
import { useTitleSuffixes } from "./titleSuffixStore";
import { titleWithSuffix } from "./windowTitles";

/**
 * Keyboard use of the windows (mounted once by WindowManager):
 *  - Ctrl+Alt+Left / Right: snap the focused window to half the screen; Ctrl+Alt+7 9 1 3: a corner;
 *    Ctrl+Alt+Up maximises, Ctrl+Alt+Down restores.
 *  - Ctrl+Tab / Ctrl+Shift+Tab: switch between windows (most recent first). Hold Ctrl, press
 *    Tab to walk the list, let go of Ctrl to land on the highlighted window.
 */
export function WindowShortcuts() {
  const [list, setList] = useState<{ id: string; title: string }[] | null>(null);
  const [index, setIndex] = useState(0);
  // Mirrors the state for the key handlers (they must not close over stale values).
  const live = useRef<{ ids: string[]; index: number } | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const store = useWindowStore.getState();
      const snap = snapKey(event);
      if (snap) {
        const focused = Object.values(store.windows).find(
          (w) => w.isFocused && !w.isMinimized,
        );
        if (!focused) return;
        event.preventDefault();
        if (snap === "maximize") {
          if (!focused.isMaximized) store.maximizeWindow(focused.id);
        } else if (snap === "restore") {
          if (focused.isMaximized) store.maximizeWindow(focused.id);
        } else {
          store.snapWindow(focused.id, snap);
        }
        return;
      }

      const direction = switcherKey(event);
      if (!direction) return;
      const windows = mruOrder(Object.values(store.windows));
      if (windows.length < 2) return;
      event.preventDefault();
      const suffixes = useTitleSuffixes.getState().suffixes;
      if (!live.current) {
        live.current = { ids: windows.map((w) => w.id), index: 0 };
        setList(
          windows.map((w) => ({
            id: w.id,
            title: titleWithSuffix(
              store.windows[w.id].title,
              suffixes[store.windows[w.id].appId],
            ),
          })),
        );
      }
      live.current.index = stepIndex(
        live.current.index,
        live.current.ids.length,
        direction === "previous",
      );
      setIndex(live.current.index);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Control" || !live.current) return;
      const { ids, index: chosen } = live.current;
      live.current = null;
      setList(null);
      const store = useWindowStore.getState();
      const id = ids[chosen];
      if (id && store.windows[id]) store.restoreWindow(id);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  if (!list) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center">
      <ul
        role="listbox"
        aria-label="Switch window"
        className="glass-pop rounded-card flex max-w-[min(28rem,92vw)] min-w-[18rem] flex-col gap-1 p-2"
      >
        {list.map((w, i) => (
          <li
            key={w.id}
            role="option"
            aria-selected={i === index}
            className={cn(
              "rounded-control text-ink truncate px-3 py-2 text-[14px] font-semibold",
              i === index && "bg-accent-soft text-accent-ink",
            )}
          >
            {w.title}
          </li>
        ))}
      </ul>
    </div>
  );
}
