"use client";

import { Suspense, useEffect, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { motion } from "motion/react";
import { animate } from "motion";
import { cn } from "@/lib/cn";
import { springWindow } from "@/lib/motion";
import { windowFxMode } from "@/lib/displayFx";
import { firstUsable, windowShortcut } from "@/lib/focusKeys";
import { getAppComponent } from "@/components/apps/registry";
import { useWindowStore } from "./windowStore";
import { useTitleSuffixes } from "./titleSuffixStore";
import { joinSuffixes, titleWithSuffix } from "./windowTitles";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { WindowTitleBar } from "./WindowTitleBar";
import { ResizeHandles } from "./ResizeHandles";
import { AIGlowBorder } from "./AIGlowBorder";
import { sizes } from "@/lib/tokens";
import { maximizedRect } from "./windowGeometry";
import type { WindowState } from "./types";

interface WindowProps {
  id: string;
}

/** Added to a pinned window's z-index; larger than any focus counter reaches in a session. */
const PINNED_Z_BOOST = 1_000_000;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** OUTER's inline top/left/right/bottom when `isMaximized`: the whole screen. The dock (it
 *  hides itself while an app is open) and the command bar float over the window, which keeps
 *  its own bottom padding clear of the bar. The maximize/restore animation springs toward
 *  the same numbers via `maximizedRect`. */
const MAXIMIZED_INSETS = { side: 0, top: 0, bottom: 0 };

/** `--ease-smooth` as a motion tuple (src/lib/motion.ts has no twin yet). */
const easeSmooth = [0.22, 0.9, 0.28, 1] as const;

/** Window open: a soft spring with a slight overshoot (the prototype's
 *  `--ease-spring` feel). Close/minimize use smooth tweens instead. */
const windowOpenSpring = {
  type: "spring",
  stiffness: 300,
  damping: 24,
  mass: 0.9,
} as const;

function rectFromElement(el: HTMLElement): Rect {
  const box = el.getBoundingClientRect();
  return { x: box.left, y: box.top, width: box.width, height: box.height };
}

function computeMaximizedRect(): Rect {
  return maximizedRect(
    { width: window.innerWidth, height: window.innerHeight },
    MAXIMIZED_INSETS,
  );
}

/**
 * Renders one window's chrome (title bar, resize handles, drop shadow,
 * frosted rounded/clipped body, the Deloitte brand bar) and resolves + mounts its app content via the app
 * registry. `WindowManager` decides WHICH ids to render; this component
 * owns everything about rendering ONE of them.
 *
 * DOM shape is deliberate:
 *   OUTER (plain div, position:absolute, ref-mutated by drag/resize)
 *     INNER (motion.div — owns ONLY the open/close/minimize animation;
 *            frosted glass body + overflow-hidden + rounded corners +
 *            focused/unfocused shadow live here)
 *       WindowTitleBar
 *       app content
 *     AIGlowBorder (sibling BEFORE INNER, so behind it; lit while `controlledBy === "ai"`;
 *                   the rotating conic halo, see that file)
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
  const togglePinned = useWindowStore((s) => s.togglePinned);
  const titleSuffix = useTitleSuffixes((s) =>
    liveWindow ? s.suffixes[liveWindow.appId] : undefined,
  );
  const titleContext = useTitleSuffixes((s) => s.contexts[id]);
  const fxMode = useWindowStore((s) =>
    windowFxMode({
      openCount: Object.keys(s.windows).length,
      focused: s.windows[id]?.isFocused ?? false,
      lean: document.documentElement.getAttribute("data-fx") !== "rich",
    }),
  );
  const outerRef = useRef<HTMLDivElement>(null);

  // A window can be asked to close/minimize while its exit animation is
  // still playing. The store entry for close is about to disappear
  // entirely, so we snapshot it once, right when the exit begins, and
  // render from the snapshot instead of the (soon to be gone) live value
  // for the rest of the animation. See `exitIntent` below.
  const [snapshot, setSnapshot] = useState<WindowState | null>(null);
  const [exitIntent, setExitIntent] = useState<"none" | "closing" | "minimizing">("none");
  const [minimizeOrigin, setMinimizeOrigin] = useState<string | null>(null);

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

  function requestClose() {
    if (liveWindow) setSnapshot(liveWindow);
    setExitIntent("closing");
  }

  function requestMinimize() {
    if (liveWindow) setSnapshot(liveWindow);
    // Shrink toward the dock (top-center of the screen): the transform
    // origin is the dock's anchor point in this window's own coordinates.
    const el = outerRef.current;
    if (el) {
      const box = el.getBoundingClientRect();
      setMinimizeOrigin(
        `${Math.round(window.innerWidth / 2 - box.left)}px ${Math.round(
          sizes.dockHeight / 2 + 16 - box.top,
        )}px`,
      );
    }
    setExitIntent("minimizing");
  }

  // Ctrl+W / Ctrl+M act on the focused window (through the same animated
  // exit as the title-bar buttons), wherever the keyboard focus is.
  const shortcutRef = useRef<(action: "close" | "minimize") => void>(() => {});
  useEffect(() => {
    shortcutRef.current = (action) => {
      if (exitIntent !== "none" || transitionRect) return;
      if (action === "close") requestClose();
      else requestMinimize();
    };
  });
  const isFocusedWindow = liveWindow?.isFocused ?? false;
  useEffect(() => {
    if (!isFocusedWindow) return;
    function handleKeyDown(event: KeyboardEvent) {
      const action = windowShortcut(event);
      if (!action) return;
      event.preventDefault();
      shortcutRef.current(action);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isFocusedWindow]);

  // Focus moves into the window when it opens (unless its app already took
  // focus) and goes back to where it was, else the app's dock tile, when it
  // goes away.
  const appId = liveWindow?.appId ?? snapshot?.appId;
  // Read in the first render, before the app's own content can take focus.
  const [openedFrom] = useState<Element | null>(() =>
    typeof document === "undefined" ? null : document.activeElement,
  );
  useEffect(() => {
    const root = outerRef.current;
    if (!root) return;
    if (!root.contains(document.activeElement)) root.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      const target = firstUsable<Element>(
        [
          openedFrom,
          appId ? document.querySelector(`[data-dock-app="${CSS.escape(appId)}"]`) : null,
        ],
        (el) => el.isConnected && el !== document.body && "focus" in el,
      );
      (target as HTMLElement | null)?.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, []);

  const data = liveWindow ?? snapshot;
  if (!data) return null;

  const isExiting = exitIntent !== "none";
  const AppComponent = getAppComponent(data.appId);

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

  // A pinned window stays above every unpinned one, however they are focused.
  const stackIndex = data.zIndex + (data.pinned ? PINNED_Z_BOOST : 0);
  const outerStyle: CSSProperties = transitionRect
    ? {
        zIndex: stackIndex,
        width: transitionRect.width,
        height: transitionRect.height,
        transform: `translate3d(${transitionRect.x}px, ${transitionRect.y}px, 0)`,
      }
    : data.isMaximized
      ? {
          zIndex: stackIndex,
          top: MAXIMIZED_INSETS.top,
          bottom: MAXIMIZED_INSETS.bottom,
          left: MAXIMIZED_INSETS.side,
          right: MAXIMIZED_INSETS.side,
        }
      : {
          zIndex: stackIndex,
          width: data.size.width,
          height: data.size.height,
          transform: `translate3d(${data.position.x}px, ${data.position.y}px, 0)`,
        };

  const barSuffix = joinSuffixes(titleContext, titleSuffix);
  const shownTitle = titleWithSuffix(data.title, barSuffix);
  const exitAnimation =
    exitIntent === "minimizing"
      ? { opacity: 0, scale: 0.08 }
      : { opacity: 0, scale: 0.94, y: 8 };
  const exitTransition =
    exitIntent === "minimizing"
      ? { duration: 0.42, ease: easeSmooth }
      : { duration: 0.26, ease: easeSmooth };

  return (
    <div
      ref={outerRef}
      data-window-chrome={id}
      data-focused={data.isFocused}
      data-controlled-by={data.controlledBy}
      role="dialog"
      aria-modal="false"
      aria-label={shownTitle}
      tabIndex={-1}
      style={outerStyle}
      className="pointer-events-auto absolute outline-none"
      onPointerDown={() => focusWindow(id)}
    >
      <AIGlowBorder active={data.controlledBy === "ai"} inside={data.isMaximized} />
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 14 }}
        animate={
          isExiting
            ? exitAnimation
            : { opacity: 1, scale: 1, y: 0, transition: windowOpenSpring }
        }
        transition={exitTransition}
        style={
          exitIntent === "minimizing" && minimizeOrigin
            ? { transformOrigin: minimizeOrigin }
            : undefined
        }
        onAnimationComplete={handleExitAnimationComplete}
        data-focused={data.isFocused}
        data-fx-win={fxMode}
        className={cn(
          "group/win glass-win brand-bar flex h-full w-full flex-col overflow-hidden",
          "transition-[box-shadow,border-radius] duration-[400ms]",
          // A full-screen window has no rounded corners or drop shadow of its own.
          data.isMaximized
            ? "rounded-none shadow-none"
            : cn(
                "rounded-surface",
                data.isFocused ? "shadow-window-focus" : "shadow-window",
              ),
        )}
      >
        <WindowTitleBar
          id={id}
          title={data.title}
          suffix={barSuffix}
          icon={data.icon}
          isFocused={data.isFocused}
          isMaximized={data.isMaximized}
          aiControlled={data.controlledBy === "ai"}
          isPinned={data.pinned === true}
          onPinToggle={() => togglePinned(id)}
          dragDisabled={transitionRect !== null}
          rootRef={outerRef}
          onMinimize={requestMinimize}
          onMaximizeToggle={handleMaximizeToggle}
          onClose={requestClose}
        />
        <div
          className="relative min-h-0 flex-1 overflow-auto"
          // The command bar floats over a full-screen window: keep its content clear of it.
          style={
            data.isMaximized ? { paddingBottom: sizes.commandBarReserve } : undefined
          }
        >
          {AppComponent ? (
            <AppErrorBoundary appId={data.appId}>
              <Suspense fallback={<AppLoading />}>
                <AppComponent windowId={id} />
              </Suspense>
            </AppErrorBoundary>
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

/** Shown while a lazily loaded app's code is still arriving: the rough layout of an app
 *  (header, filter pills, rows) so the window does not jump when the real content lands. */
function AppLoading() {
  const bar = "bg-chip rounded-control motion-safe:animate-pulse";
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex h-full w-full flex-col gap-4 p-6"
    >
      <span className="sr-only">Loading…</span>
      <div className={cn(bar, "h-6 w-48")} />
      <div className="flex gap-2">
        <div className={cn(bar, "h-7 w-20 rounded-full")} />
        <div className={cn(bar, "h-7 w-24 rounded-full")} />
        <div className={cn(bar, "h-7 w-16 rounded-full")} />
      </div>
      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className={cn(bar, "h-14 w-full")} />
        ))}
      </div>
    </div>
  );
}

function UnregisteredAppNotice({ appId }: { appId: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-6 text-center">
      <p className="text-ink-faint text-sm">
        No app is registered for{" "}
        <code className="text-ink-muted bg-chip rounded-sm px-1.5 py-0.5 font-mono text-[12px]">
          {appId}
        </code>
        .
      </p>
    </div>
  );
}
