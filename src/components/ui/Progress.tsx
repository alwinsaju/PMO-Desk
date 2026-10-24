import * as React from "react";
import { cn } from "@/lib/cn";

/** `idle` = plain fill (no dot); `run` = shimmering fill + pulsing dot;
 *  `gate` = waiting on a human (amber); `err` = failed (red); `ok` = done. */
export type ProgressState = "idle" | "run" | "gate" | "err" | "ok";

export interface ProgressProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
> {
  /** 0-100. Clamped. */
  value: number;
  state?: ProgressState;
  /** Left caption above the bar (e.g. the current step). */
  label?: React.ReactNode;
  /** Show the percentage at the right of the caption row. */
  showPercent?: boolean;
}

/**
 * Segmented progress bar: 8px track cut into eight segments, gradient fill
 * with a travelling dot. The styles live in globals.css (`.progress*`), keyed
 * off `data-state`, so the state colors, the shimmer and the reduced-motion
 * behavior come for free. Exposes `role="progressbar"`.
 */
export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, state = "idle", label, showPercent = false, ...props }, ref) => {
    const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
    const stateColor =
      state === "gate" ? "text-amber" : state === "err" ? "text-red" : "text-ink-soft";
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        data-state={state}
        className={cn("progress", className)}
        {...props}
      >
        {(label || showPercent) && (
          <div className="text-ink-muted mb-2.5 flex items-baseline justify-between gap-2.5 text-xs font-semibold">
            <span className={cn("truncate", stateColor)}>{label}</span>
            {showPercent && (
              <span className="text-ink-soft shrink-0 tabular-nums">
                {Math.round(pct)}%
              </span>
            )}
          </div>
        )}
        <div className="progress-track">
          <div className="progress-bar">
            <i className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <i className="progress-dot" style={{ left: `${pct}%` }} />
        </div>
      </div>
    );
  },
);
Progress.displayName = "Progress";
