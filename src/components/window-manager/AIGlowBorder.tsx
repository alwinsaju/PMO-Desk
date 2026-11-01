/**
 * The "the AI is driving this window" halo (see `.ai-glow` in globals.css for the look and
 * why it is built this way). Window.tsx renders it for every window, as the first child of
 * the window's outer box and so BEHIND its clipped chrome but above neighbouring windows;
 * `active` is `controlledBy === "ai"`. It stays mounted and just fades (a CSS opacity
 * transition) so it also fades OUT when control goes back to the person, and it costs
 * nothing while inactive.
 *
 * Purely decorative: no pointer events, hidden from assistive tech. The rotation is a CSS
 * animation, so there is no React state or re-render per frame.
 */
export function AIGlowBorder({
  active,
  inside = false,
}: {
  active: boolean;
  /** A full-screen window has no room outside its edge, so the halo is drawn just inside it. */
  inside?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className="ai-glow"
      data-active={active}
      data-inside={inside}
      data-testid="ai-glow"
    />
  );
}
