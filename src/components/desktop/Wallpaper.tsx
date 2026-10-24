/**
 * Original, full-bleed CSS wallpaper. Deliberately NOT a photograph in any
 * mode: soft gradients with large blurred "glow" blobs that drift slowly,
 * per the design spec (no third-party imagery).
 *
 * FOUR layers are always in the DOM, stacked on top of each other, and the
 * one matching the two `<html>` attributes cross-fades in over 1s — pure CSS
 * (see the `.wp-*` rules in globals.css), zero client JS/state, so this is
 * still a server component (it's the one piece of Desktop.tsx that doesn't
 * need "use client"):
 *
 *   wp-lt   default light  — pastel periwinkle -> blush -> peach dusk
 *   wp-dk   default dark   — deep indigo -> violet -> teal midnight
 *   wp-dll  Deloitte light — soft grey, green + blue glows, ring outlines
 *   wp-dld  Deloitte dark  — near-black, green + dark-blue glows, rings
 *
 * Layers that are off are `visibility: hidden` with their blobs' animation
 * paused, so the blurred drifting glows only cost anything on the active one.
 *
 * Deloitte layers carry concentric, cropped ring outlines in the top-right
 * corner (one shared center, so never two overlapping circles) and one soft
 * filled disc bottom-left that touches none of them.
 */

/** Concentric rings centered off-canvas top-right, cropped by the viewport. */
function BrandRings({
  strokes,
  disc,
  discOpacity,
}: {
  strokes: readonly [string, number][];
  disc: string;
  discOpacity: number;
}) {
  const radii = [430, 310, 190];
  return (
    <svg
      className="wp-rings"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <g fill="none" strokeWidth="1.5">
        {radii.map((r, i) => (
          <circle
            key={r}
            cx="1330"
            cy="110"
            r={r}
            stroke={strokes[i][0]}
            strokeOpacity={strokes[i][1]}
          />
        ))}
      </g>
      <circle cx="90" cy="860" r="300" fill={disc} fillOpacity={discOpacity} />
    </svg>
  );
}

export function Wallpaper() {
  return (
    <div aria-hidden className="absolute inset-0 z-[var(--z-desktop)] overflow-hidden">
      {/* Default light */}
      <div className="wp-layer wp-lt">
        <i className="wp-blob wp-b1" />
        <i className="wp-blob wp-b2" />
        <i className="wp-blob wp-b3" />
        <i className="wp-blob wp-b4" />
        <div className="wp-grain" />
      </div>

      {/* Default dark */}
      <div className="wp-layer wp-dk">
        <i className="wp-blob wp-b1" />
        <i className="wp-blob wp-b2" />
        <i className="wp-blob wp-b3" />
        <i className="wp-blob wp-b4" />
        <div className="wp-grain" />
      </div>

      {/* Deloitte light */}
      <div className="wp-layer wp-dll">
        <i className="wp-blob wp-b1" />
        <i className="wp-blob wp-b2" />
        <i className="wp-blob wp-b3" />
        <BrandRings
          strokes={[
            ["#86BC25", 0.5],
            ["#00A3E0", 0.35],
            ["#86EB22", 0.55],
          ]}
          disc="#86BC25"
          discOpacity={0.1}
        />
      </div>

      {/* Deloitte dark */}
      <div className="wp-layer wp-dld">
        <i className="wp-blob wp-b1" />
        <i className="wp-blob wp-b2" />
        <i className="wp-blob wp-b3" />
        <BrandRings
          strokes={[
            ["#86EB22", 0.28],
            ["#00A3E0", 0.4],
            ["#86BC25", 0.5],
          ]}
          disc="#86EB22"
          discOpacity={0.07}
        />
      </div>
    </div>
  );
}
