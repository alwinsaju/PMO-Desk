import * as React from "react";
import { cn } from "@/lib/cn";

const fill = "bg-chip-strong motion-safe:animate-pulse";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * `line` = one line of text; `block` = a card or chart area (give it a
   * height); `list-row` = avatar, two lines and a trailing chip, the shape of
   * the final list rows.
   */
  variant?: "line" | "block" | "list-row";
  /** CSS width for `line` (number = px). */
  width?: number | string;
}

/** Placeholder that matches the final layout. Decorative: hidden from screen readers. */
export function Skeleton({
  variant = "line",
  width,
  className,
  style,
  ...props
}: SkeletonProps) {
  if (variant === "list-row") {
    return (
      <div
        aria-hidden
        className={cn("flex items-center gap-3 px-1 py-2.5", className)}
        style={style}
        {...props}
      >
        <span className={cn(fill, "h-9 w-9 shrink-0 rounded-full")} />
        <span className="flex min-w-0 flex-1 flex-col gap-2">
          <span className={cn(fill, "h-3.5 w-2/5 rounded-sm")} />
          <span className={cn(fill, "h-3 w-3/5 rounded-sm")} />
        </span>
        <span className={cn(fill, "rounded-chip h-[25px] w-16 shrink-0")} />
      </div>
    );
  }
  return (
    <div
      aria-hidden
      className={cn(
        fill,
        variant === "block" ? "rounded-card h-24 w-full" : "h-3.5 w-full rounded-sm",
        className,
      )}
      style={width === undefined ? style : { width, ...style }}
      {...props}
    />
  );
}

export interface SkeletonListProps extends React.HTMLAttributes<HTMLDivElement> {
  rows?: number;
  /** Announced to screen readers while loading. */
  label?: string;
}

/** A loading pane of list rows; one polite "Loading" announcement for the lot. */
export function SkeletonList({
  rows = 5,
  label = "Loading",
  className,
  ...props
}: SkeletonListProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      className={cn("flex flex-col divide-y divide-[var(--color-line)]", className)}
      {...props}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} variant="list-row" />
      ))}
    </div>
  );
}

const TEXT_WIDTHS = ["100%", "92%", "96%", "78%"];

export interface SkeletonTextProps extends React.HTMLAttributes<HTMLDivElement> {
  lines?: number;
}

/** A paragraph of lines; the last one is shorter, like real text. */
export function SkeletonText({ lines = 3, className, ...props }: SkeletonTextProps) {
  return (
    <div aria-hidden className={cn("flex flex-col gap-2.5", className)} {...props}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          width={
            i === lines - 1 && lines > 1 ? "60%" : TEXT_WIDTHS[i % TEXT_WIDTHS.length]
          }
        />
      ))}
    </div>
  );
}
