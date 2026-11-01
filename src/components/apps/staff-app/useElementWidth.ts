"use client";

import { useLayoutEffect, useState } from "react";

/**
 * The content width in pixels of the element given the returned `ref` callback (0 until
 * it has been measured), kept current as it resizes. A callback ref, so an element that
 * mounts later (after a loading state) is measured too.
 */
export function useElementWidth(): [(el: HTMLElement | null) => void, number] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => setWidth(Math.floor(element.clientWidth));
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, width];
}
