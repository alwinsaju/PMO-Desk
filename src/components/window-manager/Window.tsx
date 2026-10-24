"use client";

import { Suspense, useEffect, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { motion } from "motion/react";
import { animate } from "motion";
import { cn } from "@/lib/cn";
import { springWindow } from "@/lib/motion";
import { getAppComponent } from "@/components/apps/registry";
import { useWindowStore } from "./windowStore";
import { WindowTitleBar } from "./WindowTitleBar";
import { ResizeHandles } from "./ResizeHandles";
import { AIGlowBorder } from "./AIGlowBorder";
import type { WindowState } from "./types";

interface WindowProps {
  id: string;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** px — matches the `inset-3` Tailwind utility applied to OUTER when
 *  `isMaximized` (0.75rem at the default 16px root font size). Needed here
 *  as a plain number because the maximize/restore animation below has to
 *  compute an explicit target rect to spring toward — `inset-3` alone only
 *  describes the CSS end state, not a set of numbers `motion` can animate. */
const MAXIMIZE_INSET = 12;

function rectFromElement(el: HTMLElement): Rect {
  const box = el.getBoundingClientRect();
  return { x: box.left, y: box.top, width: box.width, height: box.height };
}

function computeMaximizedRect(): Rect {
  return {
    x: MAXIMIZE_INSET,
    y: MAXIMIZE_INSET,
    width: window.innerWidth - MAXIMIZE_INSET * 2,
    height: window.innerHeight - MAXIMIZE_INSET * 2,
  };
}

/**
 * Renders one window's chrome (title bar, resize handles, drop shadow,
 * rounded/clipped body) and resolves + mounts its app content via the app
 * registry. `WindowManager` decides WHICH ids to render; this component
 * owns everything about rendering ONE of them.
 *
 * DOM shape is deliberate:
 *   OUTER (plain div, position:absolute, ref-mutated by drag/resize)
 *     AIGlowBorder (sibling, `controlledBy === "ai"` only — see that file)
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
 * `static` (0/0, 100%/100%) relative to OUTER. Live drag/resize MUST stay
 * this way — see useWindowDrag.ts/useWindowResize.ts's own doc comments —
 * so maximize/restore (a one-shot toggle between two known rects, not a
 * continuous pointer-driven gesture) still needs OUTER to stay a plain div
 * too. It gets its spring animation from `handleMaximizeToggle` below
 * instead: an imperative, one-off `motion` `animate()` call directly on
 * OUTER's DOM node (same "mutate the ref, not a reactive `animate` prop"
 * category as the gesture hooks, just spring-driven instead of pointer-
 * driven), gated by `transitionRect` local state so React's own render
 * never fights it mid-flight — see that function's comment for the full
 * sequencing.
 *
 * OUTER also carries `pointer-events-auto` to counteract the
 * `pointer-events-none` on `WindowManager`'s full-viewport wrapper (see
 * that file) — everything inside OUTER inherits `auto` back from there,
 * so chrome/content stays fully interactive.
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

  // Non-null only while `handleMaximizeToggle`'s imperative spring is
  // mid-flight. Holding the actual rect (not just a boolean) matters: every
  // render while this is set has to keep producing the EXACT SAME style
  // values it started with, so React's own reconciliation never has
  // anything to "change" on OUTER's transform/width/height and leaves them
  // alone for `animate()` to keep driving directly — see
  // `handleMaximizeToggle` below.
  const [transitionRect, setTransitionRect] = useState<Rect | null>(null);
  const maximizeAnimationRef = useRef<ReturnType<typeof animate> | null>(null);

  // Stop a still-running maximize/restore spring if this window unmounts
  // mid-animation (e.g. closed immediately after being maximized), so its
  // `onComplete` never fires a state update into a torn-down component.
  useEffect(() => {
    return () => {
      maximizeAnimationRef.current?.stop();
    };
  }, []);

  // A click that lands inside a same-origin-policy-opaque <iframe> (e.g.
  // web-app's embedded real sites) never bubbles a pointerdown out to
  // OUTER's own handler below — the click happens inside a different
  // document, so nothing bubbles through this document's tree at all. The
  // one signal available from out here is that the iframe ELEMENT itself
  // (in THIS document) becomes `document.activeElement` and fires
  // `focusin` (which does bubble, unlike `focus`) the moment focus moves
  // into it. Generic to any window that happens to render an iframe
  // anywhere in its content, not specific to web-app or any other app.
  useEffect(() => {
    function handleFocusIn(event: FocusEvent) {
      if (
        event.target instanceof HTMLIFrameElement &&
        outerRef.current?.contains(event.target)
      ) {
        focusWindow(id);
      }
    }
    document.addEventListener("focusin", handleFocusIn);
    return () => document.removeEventListener("focusin", handleFocusIn);
  }, [id, focusWindow]);

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

  /**
   * Maximize/restore, animated: a spring between the pre- and post-toggle
   * rects, reusing `springWindow` for the same "soft, substantial" feel as
   * open/close/minimize. Unlike those, this can't lean on `motion`'s
   * reactive `animate` prop on a `motion.div` — OUTER has to stay a plain,
   * ref-mutated div (see this file's top comment and useWindowDrag.ts) — so
   * this drives an imperative, one-off `animate()` call on OUTER's raw DOM
   * node instead, the same "mutate the ref directly" category as the
   * gesture hooks, just spring- rather than pointer-driven.
   *
   * Sequencing matters here in a way it doesn't for a pointer gesture,
   * because a toggle has to reconcile with React/the store rather than only
   * ever being read by them after the fact:
   *
   * 1. Commit `maximizeWindow(id)` right away, so the control icon and any
   *    other `data.isMaximized`-driven UI update the instant the user
   *    clicks, same as before this change.
   * 2. But render OUTER's `transform`/width/height from local
   *    `transitionRect` (frozen at the CURRENT rect) instead of the new
   *    `data.*` for as long as it's set, wrapped in `flushSync` so that
   *    render actually commits before `animate()` starts. Skipping this
   *    would let two writers race the same DOM properties: `animate()`
   *    mutating them frame-by-frame while a subsequent, unrelated re-render
   *    (e.g. a focus change) reads the ALREADY-new `data.isMaximized` and
   *    renders the OTHER mode (explicit rect vs `inset-3`), stomping
   *    `animate()`'s in-progress values back to a stale starting point.
   *    Freezing `transitionRect` means every render in between produces the
   *    exact same style values, so React never has a diff to apply there —
   *    the DOM node is left entirely to `animate()` until it finishes.
   * 3. `animate()`'s `onComplete` clears `transitionRect`, handing rendering
   *    back to the plain `data.*`-driven styles below — which by then
   *    exactly match where the spring just landed (maximized uses the same
   *    12px-inset math as `computeMaximizedRect`; restored uses
   *    `restoreBounds`, captured as this toggle's target below), so the
   *    handoff is visually seamless.
   */
  function handleMaximizeToggle() {
    const el = outerRef.current;
    if (!el) {
      maximizeWindow(id);
      return;
    }
    // Already mid-toggle — ignore a second click (e.g. the maximize/
    // restore button mashed) rather than starting a competing animation.
    if (transitionRect) return;

    const goingToMaximize = !data.isMaximized;
    const fromRect: Rect = data.isMaximized
      ? rectFromElement(el)
      : { x: data.position.x, y: data.position.y, ...data.size };
    const toRect: Rect = goingToMaximize
      ? computeMaximizedRect()
      : data.restoreBounds
        ? {
            x: data.restoreBounds.position.x,
            y: data.restoreBounds.position.y,
            ...data.restoreBounds.size,
          }
        : fromRect;

    flushSync(() => setTransitionRect(fromRect));
    maximizeWindow(id);

    maximizeAnimationRef.current = animate(
      el,
      {
        x: [fromRect.x, toRect.x],
        y: [fromRect.y, toRect.y],
        width: [fromRect.width, toRect.width],
        height: [fromRect.height, toRect.height],
      },
      { ...springWindow, onComplete: () => setTransitionRect(null) },
    );
  }

  const outerStyle: CSSProperties = transitionRect
    ? {
        zIndex: data.zIndex,
        width: transitionRect.width,
        height: transitionRect.height,
        transform: `translate3d(${transitionRect.x}px, ${transitionRect.y}px, 0)`,
      }
    : data.isMaximized
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
      className={cn(
        "pointer-events-auto absolute",
        !transitionRect && data.isMaximized && "inset-3",
      )}
      onPointerDown={() => focusWindow(id)}
    >
      {data.controlledBy === "ai" && <AIGlowBorder />}
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={isExiting ? { opacity: 0, scale: 0.96 } : { opacity: 1, scale: 1 }}
        transition={springWindow}
        onAnimationComplete={handleExitAnimationComplete}
        className="rounded-window bg-surface-elevated shadow-float flex h-full w-full flex-col overflow-hidden"
      >
        <WindowTitleBar
          id={id}
          title={data.title}
          icon={data.icon}
          isFocused={data.isFocused}
          isMaximized={data.isMaximized}
          dragDisabled={transitionRect !== null}
          rootRef={outerRef}
          onMinimize={requestMinimize}
          onMaximizeToggle={handleMaximizeToggle}
          onClose={requestClose}
        />
        <div className="relative min-h-0 flex-1 overflow-auto">
          {AppComponent ? (
            <Suspense fallback={<AppLoading />}>
              <AppComponent windowId={id} />
            </Suspense>
          ) : (
            <UnregisteredAppNotice appId={data.appId} />
          )}
        </div>
      </motion.div>
      {!data.isMaximized && !isExiting && !transitionRect && (
        <ResizeHandles id={id} rootRef={outerRef} />
      )}
    </div>
  );
}

/** Shown for the instant a lazily loaded app's code is still arriving. */
function AppLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <p className="text-ink-faint text-sm">Loading…</p>
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
