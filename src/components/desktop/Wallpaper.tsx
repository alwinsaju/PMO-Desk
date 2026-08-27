/**
 * Original, full-bleed CSS wallpaper. Deliberately NOT a photograph in
 * either theme: layered radial + linear gradients plus a very faint noise
 * overlay for texture, per the design spec (no third-party imagery).
 *
 * Light variant: a soft pastel dusk-over-a-lake mood (blush pink fading
 * through lavender into soft blue-gray). Dark variant: the same
 * atmosphere at midnight instead of dusk — deep navy/indigo/violet blends
 * fading toward true black, same soft/premium mood, no photo, no second
 * accent hue (the indigo/violet here is decorative wallpaper art, not the
 * app's one interactive accent color — see tokens.css).
 *
 * The two variants are both always in the DOM; only one is ever visible,
 * switched purely by CSS via the `dark:` variant tokens.css defines
 * (`@custom-variant dark`, keyed off `data-theme="dark"` on <html>). That
 * means this stays a pure server-rendered swap with zero client JS/state —
 * safe as a server component, same as before (it's the one piece of
 * Desktop.tsx that doesn't need "use client").
 */
export function Wallpaper() {
  return (
    <div className="absolute inset-0 z-[var(--z-desktop)] overflow-hidden">
      {/* ---------------------------------------------------------------
       * Light: dusk over a lake.
       * ------------------------------------------------------------- */}
      <div className="absolute inset-0 overflow-hidden bg-[#c3cdd6] dark:hidden">
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

      {/* ---------------------------------------------------------------
       * Dark: the same dusk-over-a-lake structure, recolored for
       * midnight — a cool indigo "moon glow" in place of the dusk sun,
       * and a navy/indigo/violet wash fading to near-black instead of the
       * light pastel one.
       * ------------------------------------------------------------- */}
      <div className="absolute inset-0 hidden overflow-hidden bg-[#05060f] dark:block">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage: `
              radial-gradient(ellipse 70% 45% at 46% 22%, rgba(88, 101, 242, 0.22), rgba(88, 101, 242, 0) 60%),
              radial-gradient(ellipse 55% 38% at 58% 14%, rgba(129, 90, 214, 0.14), rgba(129, 90, 214, 0) 65%),
              linear-gradient(
                182deg,
                #0a0e22 0%,
                #121a3a 15%,
                #1b2452 32%,
                #262045 48%,
                #1c2140 62%,
                #131730 76%,
                #0b0e20 90%,
                #05060f 100%
              )
            `,
          }}
        />

        {/* Same noise treatment as the light variant, for the same reason. */}
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

        {/* Slightly stronger vignette than the light variant — the same
            edge-contrast purpose, tuned up a touch since the base is
            already so dark that a light-mode-strength vignette would be
            nearly invisible. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 80% 70% at 50% 50%, transparent 50%, rgba(0, 0, 0, 0.35) 100%)",
          }}
        />
      </div>
    </div>
  );
}
