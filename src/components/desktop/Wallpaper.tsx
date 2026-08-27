/**
 * Original, full-bleed CSS wallpaper — a soft pastel dusk-over-a-lake mood
 * (blush pink fading through lavender into soft blue-gray). Deliberately
 * NOT a photograph: layered radial + linear gradients plus a very faint
 * noise overlay for texture, per the design spec (no third-party imagery).
 *
 * Pure presentation, no props/state — safe as a server component (it's the
 * one piece of Desktop.tsx that doesn't need "use client").
 */
export function Wallpaper() {
  return (
    <div className="absolute inset-0 z-[var(--z-desktop)] overflow-hidden bg-[#c3cdd6]">
      {/* Base sky-to-lake gradient. A wide, softly-blurred radial "glow"
          (the dusk sun) sits slightly off-center in the upper-middle band;
          the linear gradient carries the overall cool -> warm -> cool read
          from the top of the sky down through the water at the bottom. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage: `
            radial-gradient(ellipse 70% 45% at 46% 22%, rgba(255, 214, 197, 0.55), rgba(255, 214, 197, 0) 60%),
            radial-gradient(ellipse 55% 38% at 58% 14%, rgba(255, 236, 214, 0.35), rgba(255, 236, 214, 0) 65%),
            linear-gradient(
              182deg,
              #c7d2e4 0%,
              #d3cbe0 15%,
              #e6c6d6 32%,
              #f4ccc8 48%,
              #f2d3c6 62%,
              #ddd0cc 76%,
              #c9d2d6 90%,
              #bfcbd1 100%
            )
          `,
        }}
      />

      {/* Very faint film-grain noise for texture, blended so it adds grain
          without shifting the underlying hues. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.05] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.9 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          backgroundRepeat: "repeat",
          backgroundSize: "120px 120px",
        }}
      />

      {/* Subtle vignette so floating chrome near the edges (dock, corner
          presence avatars) always has enough contrast to read clearly. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 80% 70% at 50% 50%, transparent 55%, rgba(20, 20, 25, 0.08) 100%)",
        }}
      />
    </div>
  );
}
