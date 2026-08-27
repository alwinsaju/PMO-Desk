"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { useWindowResize, type ResizeDirection } from "./useWindowResize";

interface ResizeHandlesProps {
  id: string;
  /** Ref of the OUTER window element — see useWindowResize for why. */
  rootRef: React.RefObject<HTMLElement | null>;
}

const EDGE_SIZE = 6; // px — invisible grab strip straddling each straight edge
const CORNER_SIZE = 16; // px — square grab area straddling each corner
const EDGE_INSET = 10; // px — keeps straight edges clear of the corner zones

/** Precise pixel offsets so each handle straddles the visual window edge
 *  (half outside, half inside) rather than sitting entirely inside it —
 *  Tailwind's spacing scale doesn't hit these exact negative offsets, so
 *  this is plain inline style rather than utility classes. */
const HANDLE_STYLE: Record<ResizeDirection, CSSProperties> = {
  n: { left: EDGE_INSET, right: EDGE_INSET, top: -EDGE_SIZE / 2, height: EDGE_SIZE },
  s: { left: EDGE_INSET, right: EDGE_INSET, bottom: -EDGE_SIZE / 2, height: EDGE_SIZE },
  e: { top: EDGE_INSET, bottom: EDGE_INSET, right: -EDGE_SIZE / 2, width: EDGE_SIZE },
  w: { top: EDGE_INSET, bottom: EDGE_INSET, left: -EDGE_SIZE / 2, width: EDGE_SIZE },
  ne: {
    top: -CORNER_SIZE / 2,
    right: -CORNER_SIZE / 2,
    width: CORNER_SIZE,
    height: CORNER_SIZE,
  },
  nw: {
    top: -CORNER_SIZE / 2,
    left: -CORNER_SIZE / 2,
    width: CORNER_SIZE,
    height: CORNER_SIZE,
  },
  se: {
    bottom: -CORNER_SIZE / 2,
    right: -CORNER_SIZE / 2,
    width: CORNER_SIZE,
    height: CORNER_SIZE,
  },
  sw: {
    bottom: -CORNER_SIZE / 2,
    left: -CORNER_SIZE / 2,
    width: CORNER_SIZE,
    height: CORNER_SIZE,
  },
};

const HANDLE_CURSOR: Record<ResizeDirection, string> = {
  n: "cursor-ns-resize",
  s: "cursor-ns-resize",
  e: "cursor-ew-resize",
  w: "cursor-ew-resize",
  ne: "cursor-nesw-resize",
  sw: "cursor-nesw-resize",
  nw: "cursor-nwse-resize",
  se: "cursor-nwse-resize",
};

const DIRECTIONS = Object.keys(HANDLE_STYLE) as ResizeDirection[];

/**
 * The 8 invisible resize handles along a window's edges/corners. Rendered as
 * SIBLINGS of the window's clipped/rounded chrome (not children of it) so
 * they can straddle the visual edge for an easier grab target without being
 * clipped by the chrome's `overflow-hidden`.
 */
export function ResizeHandles({ id, rootRef }: ResizeHandlesProps) {
  return (
    <>
      {DIRECTIONS.map((direction) => (
        <ResizeHandle key={direction} id={id} rootRef={rootRef} direction={direction} />
      ))}
    </>
  );
}

function ResizeHandle({
  id,
  rootRef,
  direction,
}: {
  id: string;
  rootRef: React.RefObject<HTMLElement | null>;
  direction: ResizeDirection;
}) {
  const bindResize = useWindowResize(id, rootRef, direction);

  return (
    <div
      {...bindResize()}
      style={HANDLE_STYLE[direction]}
      className={cn("absolute z-10 touch-none", HANDLE_CURSOR[direction])}
    />
  );
}
