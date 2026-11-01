// The brand-switch animation: the Deloitte green dot grows from the toggle into a circular
// reveal of the new look, led by three glowing rings (the wallpaper's concentric rings, set
// moving). Entering Deloitte mode expands out of the toggle; leaving it collapses back into
// it. It runs inside the View Transition that `withLookTransition` (theme.ts) starts:
//   - the page's own snapshot is revealed with a clip-path circle (one cheap animation of a
//     texture the browser already holds), and
//   - the dot and rings are one extra overlay that is part of the NEW page state, so the live
//     new snapshot carries it (a layer of its own, with its own view-transition-name, cost about
//     40% of the frames under software rendering); they move with transform and opacity only.
// The geometry and the plan are plain functions so they can be tested; `playBrandReveal`
// touches the DOM and never throws (a failed effect just leaves the plain cross-fade).

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface RingPlan {
  color: string;
  /** Start delay in ms, so the rings trail one another. */
  delay: number;
  /** How far it grows, as a share of the full reveal radius. */
  reach: number;
  /** Peak opacity. */
  opacity: number;
}

export const REVEAL_MS = 900;
export const REVEAL_EASING = "cubic-bezier(0.65, 0, 0.35, 1)";
/** The ring bitmap is drawn at this diameter and scaled up by the compositor. */
const RING_BASE = 480;

const DELOITTE_COLORS = ["#86eb22", "#00a3e0", "#86bc25"] as const;
const DEFAULT_COLORS = ["#8254ff", "#ff3f96", "#ffc53d"] as const;

/** The distance from `origin` to the farthest corner: a circle this big covers the screen. */
export function revealRadius(origin: Point, viewport: Viewport): number {
  const dx = Math.max(origin.x, viewport.width - origin.x);
  const dy = Math.max(origin.y, viewport.height - origin.y);
  return Math.ceil(Math.hypot(dx, dy));
}

/** The rings of one switch, leading ring first. */
export function ringPlan(entering: boolean): RingPlan[] {
  const colors = entering ? DELOITTE_COLORS : DEFAULT_COLORS;
  return [
    { color: colors[0], delay: 0, reach: 1, opacity: 0.95 },
    { color: colors[1], delay: 110, reach: 0.93, opacity: 0.7 },
    { color: colors[2], delay: 220, reach: 0.86, opacity: 0.5 },
  ];
}

/** Where the effect starts: the last pointer press, or the focused control after a keyboard
 *  press, or the middle of the screen. */
const last: { point: Point | null } = { point: null };
let listening = false;

export function trackOrigin(): void {
  if (listening || typeof window === "undefined" || !window.addEventListener) return;
  listening = true;
  window.addEventListener(
    "pointerdown",
    (event) => {
      last.point = { x: event.clientX, y: event.clientY };
    },
    { capture: true, passive: true },
  );
  window.addEventListener(
    "keydown",
    () => {
      last.point = null;
    },
    { capture: true, passive: true },
  );
}

export function currentOrigin(viewport: Viewport): Point {
  if (last.point) return last.point;
  const el = typeof document !== "undefined" ? document.activeElement : null;
  if (el && typeof el.getBoundingClientRect === "function") {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0)
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return { x: viewport.width / 2, y: viewport.height / 2 };
}

export interface BrandReveal {
  entering: boolean;
  origin: Point;
  /** Also grow the new look out of the toggle as a circle. That clip is the costly part, so it
   *  is for rich effects mode (hardware acceleration on); otherwise the page cross-fades. */
  reveal: boolean;
}

/** Whether the person has rich effects (Settings > Hardware acceleration) switched on. */
export function wantsReveal(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-fx") === "rich"
  );
}

interface Mounted {
  root: HTMLElement;
  dot: HTMLElement;
  rings: { el: HTMLElement; plan: RingPlan }[];
}

/** Builds the dot and rings. Called inside the transition's update step so the element is
 *  part of the NEW page state and gets its own live layer. */
export function mountBrandFx(reveal: BrandReveal): Mounted | null {
  try {
    const root = document.createElement("div");
    root.setAttribute("aria-hidden", "true");
    root.dataset.testid = "look-fx";
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      overflow: "hidden",
      pointerEvents: "none",
      zIndex: "2147483000",
    });
    const { x, y } = reveal.origin;
    const dotColor = reveal.entering ? "#86bc25" : "#8254ff";
    const dot = document.createElement("div");
    Object.assign(dot.style, {
      position: "absolute",
      left: `${x - 56}px`,
      top: `${y - 56}px`,
      width: "112px",
      height: "112px",
      borderRadius: "50%",
      // A soft disc drawn as a gradient: a blurred box-shadow would be re-blurred on every
      // frame by a software compositor.
      background: `radial-gradient(closest-side, ${dotColor} 0 50%, transparent 100%)`,
      opacity: "0",
      willChange: "transform, opacity",
    });
    root.appendChild(dot);
    const rings = ringPlan(reveal.entering).map((plan) => {
      const el = document.createElement("div");
      Object.assign(el.style, {
        position: "absolute",
        left: `${x - RING_BASE / 2}px`,
        top: `${y - RING_BASE / 2}px`,
        width: `${RING_BASE}px`,
        height: `${RING_BASE}px`,
        borderRadius: "50%",
        background: `radial-gradient(closest-side, transparent 0 88%, ${plan.color} 96%, transparent 100%)`,
        opacity: "0",
        transform: "scale(0)",
        willChange: "transform, opacity",
      });
      root.appendChild(el);
      return { el, plan };
    });
    document.body.appendChild(root);
    return { root, dot, rings };
  } catch {
    return null;
  }
}

/** Starts every animation. Resolves when they have all finished (or failed). */
export async function playBrandReveal(
  reveal: BrandReveal,
  viewport: Viewport,
  mounted: Mounted | null,
): Promise<void> {
  const { entering, origin } = reveal;
  const full = revealRadius(origin, viewport);
  const at = `at ${origin.x}px ${origin.y}px`;
  const finished: Promise<unknown>[] = [];
  const run = (el: Animatable, frames: Keyframe[], options: KeyframeAnimationOptions) => {
    try {
      finished.push(el.animate(frames, { fill: "both", ...options }).finished);
    } catch {
      /* the plain cross-fade is still there */
    }
  };

  // The page itself (rich effects only): the new look grows out of the toggle, or the old one
  // shrinks back into it. Otherwise the page's own cross-fade runs.
  if (reveal.reveal) {
    const grow = [`circle(0px ${at})`, `circle(${full}px ${at})`];
    run(
      document.documentElement,
      [
        { clipPath: entering ? grow[0] : grow[1] },
        { clipPath: entering ? grow[1] : grow[0] },
      ],
      {
        duration: REVEAL_MS,
        easing: REVEAL_EASING,
        pseudoElement: entering
          ? "::view-transition-new(root)"
          : "::view-transition-old(root)",
      },
    );
  }

  if (mounted) {
    // The dot swells and melts into the first ring.
    run(
      mounted.dot,
      [
        { opacity: 0, transform: "scale(0.2)" },
        { opacity: 1, transform: "scale(1)", offset: 0.25 },
        { opacity: 0, transform: "scale(2.6)" },
      ],
      { duration: entering ? 520 : 640, easing: "ease-out" },
    );
    for (const { el, plan } of mounted.rings) {
      const end = (full / (RING_BASE / 2)) * plan.reach;
      const out: Keyframe[] = [
        { opacity: 0, transform: "scale(0)", offset: 0 },
        { opacity: plan.opacity, transform: `scale(${end * 0.18})`, offset: 0.18 },
        { opacity: plan.opacity, transform: `scale(${end * 0.8})`, offset: 0.75 },
        { opacity: 0, transform: `scale(${end})`, offset: 1 },
      ];
      const back = out.map((f) => ({ ...f, offset: 1 - (f.offset as number) })).reverse();
      // Leaving: the rings run the other way, converging on the toggle.
      run(el, entering ? out : back, {
        duration: REVEAL_MS - plan.delay * 0.4,
        delay: plan.delay,
        easing: REVEAL_EASING,
      });
    }
  }
  await Promise.allSettled(finished);
  mounted?.root.remove();
}
