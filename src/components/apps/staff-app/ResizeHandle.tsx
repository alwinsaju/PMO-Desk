"use client";

import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/cn";

/**
 * A draggable divider for a resizable size. Drag with the mouse or touch, nudge
 * with the arrow keys (Shift for bigger steps), double-click or press Home to
 * reset. `invert` is for a divider on the LEFT edge of the thing it sizes, where
 * dragging left makes it bigger.
 */
export function ResizeHandle({
  label,
  value,
  min,
  max,
  invert = false,
  onChange,
  onReset,
  className,
  style,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  invert?: boolean;
  onChange: (value: number) => void;
  onReset: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const drag = useRef<{ x: number; start: number } | null>(null);
  const sign = invert ? -1 : 1;

  function move(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    onChange(drag.current.start + sign * (event.clientX - drag.current.x));
  }

  function end(event: PointerEvent<HTMLDivElement>) {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function key(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 48 : 12;
    if (event.key === "ArrowLeft") onChange(value - sign * step);
    else if (event.key === "ArrowRight") onChange(value + sign * step);
    else if (event.key === "Home") onReset();
    else return;
    event.preventDefault();
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      style={style}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = { x: event.clientX, start: value };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={key}
      className={cn(
        "group absolute z-[2] flex w-2 cursor-col-resize touch-none justify-center outline-none",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "bg-line-strong h-full w-px transition-colors",
          "group-hover:bg-accent group-focus-visible:bg-accent group-active:bg-accent",
          "group-hover:w-0.5 group-focus-visible:w-0.5 group-active:w-0.5",
        )}
      />
    </div>
  );
}
