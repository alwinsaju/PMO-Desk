/**
 * Where (and how big) a newly opened window goes. Pure and import-free so
 * `pnpm test` can load it straight into Node's test runner
 * (windowGeometry.test.mjs) — `windowStore.ts` just feeds it the live
 * viewport and the numbers from `windowDefaults` (src/lib/tokens.ts).
 *
 * Every app opens at the same size (`config.size`), shrunk to fit a small
 * viewport. Each new window is nudged down-right by a cascade step, centered
 * as a group so the whole cascade sits in the middle of the screen; the step
 * itself shrinks when there is not enough room to cascade `cascadeWrap`
 * windows, and the result is always inside the keep-clear insets (below the
 * dock, above the command bar).
 */

export interface GeometryConfig {
  size: { width: number; height: number };
  minSize: { width: number; height: number };
  cascadeOffset: number;
  cascadeWrap: number;
  insets: { side: number; top: number; bottom: number };
}

export interface Viewport {
  width: number;
  height: number;
}

export interface WindowGeometry {
  position: { x: number; y: number };
  size: { width: number; height: number };
}

/** `viewport` is null on the server (no clamping possible); the unclamped
 *  result is only ever used if a window is opened before hydration. */
export function defaultWindowGeometry(
  openCount: number,
  viewport: Viewport | null,
  config: GeometryConfig,
): WindowGeometry {
  const { insets, cascadeOffset, cascadeWrap, minSize } = config;
  const index = openCount % cascadeWrap;
  const steps = Math.max(1, cascadeWrap - 1);

  const availW = viewport ? viewport.width - insets.side * 2 : Infinity;
  const availH = viewport ? viewport.height - insets.top - insets.bottom : Infinity;
  const width = Math.max(minSize.width, Math.min(config.size.width, availW));
  const height = Math.max(minSize.height, Math.min(config.size.height, availH));

  if (!viewport) {
    return {
      size: { width, height },
      position: {
        x: insets.side + index * cascadeOffset,
        y: insets.top + index * cascadeOffset,
      },
    };
  }

  const freeX = Math.max(0, availW - width);
  const freeY = Math.max(0, availH - height);
  const stepX = Math.min(cascadeOffset, freeX / steps);
  const stepY = Math.min(cascadeOffset, freeY / steps);

  return {
    size: { width, height },
    position: {
      x: Math.round(insets.side + (freeX - stepX * steps) / 2 + index * stepX),
      y: Math.round(insets.top + index * stepY),
    },
  };
}
