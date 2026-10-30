"use client";

import { getDesktopBridge } from "@/lib/pmo/desktopBridge";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The nearest ancestor that scrolls vertically (or null when the content fits). */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (
      /(auto|scroll)/.test(style.overflowY) &&
      node.scrollHeight > node.clientHeight + 2
    )
      return node;
  }
  return null;
}

/**
 * Takes a picture of everything inside `el`, including what has scrolled out of view: scrolls the
 * container a screen at a time, captures each slice through the desktop shell and stitches them on a
 * canvas. Resolves to PNG bytes, or null outside the desktop app or when a capture fails.
 */
export async function captureTall(el: HTMLElement): Promise<Uint8Array | null> {
  const view = getDesktopBridge()?.view;
  if (!view) return null;
  const scroller = scrollerOf(el);
  const frame = (scroller ?? el).getBoundingClientRect();
  const total = scroller ? scroller.scrollHeight : el.scrollHeight;
  const step = Math.floor(frame.height);
  const start = scroller?.scrollTop ?? 0;
  const slices: { bitmap: ImageBitmap; top: number; height: number }[] = [];
  try {
    for (let y = 0; y < total; y += step) {
      if (scroller) scroller.scrollTop = y;
      await pause(160);
      const actual = scroller ? scroller.scrollTop : 0;
      // The last screen cannot scroll past the end, so it overlaps: keep only the new part.
      const skip = y - actual;
      const height = Math.min(step - Math.max(0, skip), total - y);
      if (height <= 0) break;
      const png = await view.capture({
        x: frame.x,
        y: frame.y + Math.max(0, skip),
        width: frame.width,
        height,
      });
      if (!png) return null;
      slices.push({
        bitmap: await createImageBitmap(
          new Blob([png as BlobPart], { type: "image/png" }),
        ),
        top: y,
        height,
      });
    }
  } finally {
    if (scroller) scroller.scrollTop = start;
  }
  if (slices.length === 0) return null;
  const scale = slices[0].bitmap.width / frame.width;
  const canvas = document.createElement("canvas");
  canvas.width = slices[0].bitmap.width;
  canvas.height = Math.round(total * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  for (const s of slices) ctx.drawImage(s.bitmap, 0, Math.round(s.top * scale));
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** Captures `el` whole and saves it as a PNG or PDF through the shell's save dialog; resolves to the path. */
export async function exportElement(
  el: HTMLElement,
  format: "png" | "pdf",
  name: string,
): Promise<string | null> {
  const view = getDesktopBridge()?.view;
  if (!view) return null;
  const png = await captureTall(el);
  return png ? view.save(format, name, png) : null;
}
