"use client";

import { useEffect, useLayoutEffect, useState } from "react";

/**
 * Scroll position and visible height of the element given the returned `ref` callback, kept
 * current while it scrolls and resizes (scroll events are folded into one update per frame).
 * The element itself is returned too, for scrolling it.
 */
export function useScrollWindow(): [
  (el: HTMLElement | null) => void,
  { scrollTop: number; height: number; element: HTMLElement | null },
] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => setHeight(Math.floor(element.clientHeight));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  useEffect(() => {
    if (!element) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setScrollTop(element.scrollTop);
      });
    };
    setScrollTop(element.scrollTop);
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [element]);

  return [setElement, { scrollTop, height, element }];
}
