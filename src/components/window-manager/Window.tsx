"use client";

import { useRef, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { springWindow } from "@/lib/motion";
import { getAppComponent } from "@/components/apps/registry";
import { useWindowStore } from "./windowStore";
import { WindowTitleBar } from "./WindowTitleBar";
import { ResizeHandles } from "./ResizeHandles";
import type { WindowState } from "./types";

interface WindowProps {
  id: string;
}

/**
 * Renders one window's chrome (title bar, resize handles, drop shadow,
 * rounded/clipped body) and resolves + mounts its app content via the app
 * registry. `WindowManager` decides WHICH ids to render; this component
 * owns everything about rendering ONE of them.
 *
 * DOM shape is deliberate:
 *   OUTER (plain div, position:absolute, ref-mutated by drag/resize)
 *     INNER (motion.div — owns ONLY the open/close pop animation;
 *            overflow-hidden + rounded corners + shadow live here)
 *       WindowTitleBar
 *       app content
 *     ResizeHandles (siblings of INNER, so they aren't clipped by its
 *                    overflow-hidden and can straddle the visual edge)
 *
 * Splitting OUTER/INNER like this means the drag/resize hooks can mutate
 * OUTER's `transform`/width/height directly on every frame (no React
 * re-render) with zero risk of fighting `motion`'s own animation engine,
 * since `motion` only ever touches INNER, and INNER's position is always
 * `static` (0/0, 100%/100%) relative to OUTER.
 */
export function Window({ id }: WindowProps) {
  const liveWindow = useWindowStore((s) => s.windows[id]);
  const minimizeWindow = useWindowStore((s) => s.minimizeWindow);
  const maximizeWindow = useWindowStore((s) => s.maximizeWindow);
  const closeWindow = useWindowStore((s) => s.closeWindow);
  const focusWindow = useWindowStore((s) => s.focusWindow);

  const outerRef = useRef<HTMLDivElement>(null);

  // A window can be asked to close/minimize while its exit animation is
  // still playing. The store entry for close is about to disappear
  // entirely, so we snapshot it once, right when the exit begins, and
  // render from the snapshot instead of the (soon to be gone) live value
  // for the rest of the animation. See `exitIntent` below.
  const [snapshot, setSnapshot] = useState<WindowState | null>(null);
  const [exitIntent, setExitIntent] = useState<"none" | "closing" | "minimizing">("none");

  const data = liveWindow ?? snapshot;
  if (!data) return null;

  const isExiting = exitIntent !== "none";
  const AppComponent = getAppComponent(data.appId);

  function requestClose() {
    if (liveWindow) setSnapshot(liveWindow);
    setExitIntent("closing");
  }

  function requestMinimize() {
    if (liveWindow) setSnapshot(liveWindow);
    setExitIntent("minimizing");
  }

  function handleExitAnimationComplete() {
    if (exitIntent === "closing") closeWindow(id);
    else if (exitIntent === "minimizing") minimizeWindow(id);
  }

  const outerStyle = data.isMaximized
    ? { zIndex: data.zIndex }
    : {
        zIndex: data.zIndex,
        width: data.size.width,
        height: data.size.height,
        transform: `translate3d(${data.position.x}px, ${data.position.y}px, 0)`,
      };

  return (
    <div
      ref={outerRef}
      style={outerStyle}
      className={cn("absolute", data.isMaximized && "inset-3")}
      onPointerDown={() => focusWindow(id)}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={isExiting ? { opacity: 0, scale: 0.96 } : { opacity: 1, scale: 1 }}
        transition={springWindow}
        onAnimationComplete={handleExitAnimationComplete}
        className={cn(
          "rounded-window bg-surface-elevated shadow-float flex h-full w-full flex-col overflow-hidden",
          data.controlledBy === "ai" && "ring-accent/50 ring-1",
        )}
      >
        <WindowTitleBar
          id={id}
          title={data.title}
          icon={data.icon}
          isFocused={data.isFocused}
          isMaximized={data.isMaximized}
          rootRef={outerRef}
          onMinimize={requestMinimize}
          onMaximizeToggle={() => maximizeWindow(id)}
          onClose={requestClose}
        />
        <div className="relative min-h-0 flex-1 overflow-auto">
          {AppComponent ? (
            <AppComponent windowId={id} />
          ) : (
            <UnregisteredAppNotice appId={data.appId} />
          )}
        </div>
      </motion.div>
      {!data.isMaximized && !isExiting && <ResizeHandles id={id} rootRef={outerRef} />}
    </div>
  );
}

function UnregisteredAppNotice({ appId }: { appId: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-6 text-center">
      <p className="text-ink-faint text-sm">
        No app is registered for{" "}
        <code className="text-ink-muted rounded-sm bg-neutral-100 px-1.5 py-0.5 font-mono text-[12px]">
          {appId}
        </code>
        .
      </p>
    </div>
  );
}
