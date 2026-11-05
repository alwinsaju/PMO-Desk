"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  WINDOW_THRESHOLD,
  averageHeight,
  buildOffsets,
  columnsFor,
  itemsOfRows,
  rowCount,
  scrollDeltaFor,
  windowFor,
  type RowWindow,
} from "@/lib/registers/windowing";

export interface WindowedRows {
  /** False for a short list: every item is drawn and the other fields are the plain values. */
  windowed: boolean;
  /** The items to draw, as a range of the item list. */
  from: number;
  to: number;
  /** Spacer heights above and below the drawn rows. */
  padTop: number;
  padBottom: number;
  /** Items per row (1 for a table). */
  columns: number;
  /** Scroll so the row holding item `index` is at the top, under a sticky header. */
  scrollToItem: (index: number) => void;
}

const FULL: RowWindow = { start: 0, end: 0, padTop: 0, padBottom: 0, total: 0 };

/**
 * Draws only the rows of a long list that are on screen. `ids` are the items in order; `scrollerRef` is the box that
 * scrolls and `contentRef` the element that holds the drawn rows (a `tbody` or a grid). Each drawn row carries
 * `data-measure-id` (its item id): heights are measured after every render, so rows of different heights work and a
 * row not yet seen counts as the average. `grid` makes rows of as many cards as fit across.
 */
export function useWindowedRows({
  ids,
  scrollerRef,
  contentRef,
  enabled,
  estimate,
  overscan = 6,
  grid,
  header = 0,
}: {
  ids: readonly string[];
  scrollerRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  estimate: number;
  overscan?: number;
  grid?: { min: number; gap: number };
  header?: number;
}): WindowedRows {
  const active = enabled && ids.length > WINDOW_THRESHOLD;
  const heights = useRef(new Map<string, number>());
  const [, bump] = useState(0);
  const [view, setView] = useState({ top: 0, height: 800, width: 800 });

  // Which part of the content is on screen, and how wide it is. Read on scroll and resize.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!active || !scroller) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const content = contentRef.current;
      if (!content) return;
      const top =
        scroller.getBoundingClientRect().top - content.getBoundingClientRect().top;
      const next = { top, height: scroller.clientHeight, width: content.clientWidth };
      setView((cur) =>
        Math.abs(cur.top - next.top) < 1 &&
        cur.height === next.height &&
        cur.width === next.width
          ? cur
          : next,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    scroller.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => {
      scroller.removeEventListener("scroll", schedule);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [active, scrollerRef, contentRef]);

  const columns = grid ? columnsFor(view.width, grid.min, grid.gap) : 1;
  const gap = grid?.gap ?? 0;
  const rows = rowCount(ids.length, columns);
  const average = averageHeight(heights.current.values(), estimate);
  const rowHeight = (row: number): number => {
    let tallest = 0;
    let seen = false;
    for (let i = row * columns; i < Math.min(ids.length, (row + 1) * columns); i += 1) {
      const h = heights.current.get(ids[i]!);
      if (h !== undefined) {
        seen = true;
        tallest = Math.max(tallest, h);
      }
    }
    return (seen ? tallest : average) + gap;
  };
  // `heights` is a ref mutated by the measuring effect below, so this must be recomputed on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const offsets = active ? buildOffsets(rows, rowHeight) : [0];
  const win = active ? windowFor(offsets, view.top, view.height, overscan) : FULL;

  // Measure what is drawn; a changed height moves the spacers, so draw again once.
  // Runs after every render on purpose: it only re-renders again when a measured height changed, so it settles.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!active || !content) return;
    let changed = false;
    for (const el of content.querySelectorAll<HTMLElement>("[data-measure-id]")) {
      const id = el.dataset.measureId!;
      const h = el.offsetHeight;
      if (Math.abs((heights.current.get(id) ?? -10) - h) >= 1) {
        heights.current.set(id, h);
        changed = true;
      }
    }
    if (changed) bump((n) => n + 1);
  });

  // The measured heights belong to the rows of one layout; a different list or width starts again.
  useEffect(() => {
    heights.current.clear();
  }, [columns, active]);

  const scrollToItem = useCallback(
    (index: number) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      scroller.scrollTop += scrollDeltaFor(
        offsets,
        Math.floor(index / columns),
        view.top,
        header,
      );
    },
    [scrollerRef, offsets, columns, view.top, header],
  );

  if (!active) {
    return {
      windowed: false,
      from: 0,
      to: ids.length,
      padTop: 0,
      padBottom: 0,
      columns: 1,
      scrollToItem: () => undefined,
    };
  }
  const { from, to } = itemsOfRows(win.start, win.end, columns, ids.length);
  return {
    windowed: true,
    from,
    to,
    padTop: win.padTop,
    padBottom: win.padBottom,
    columns,
    scrollToItem,
  };
}
