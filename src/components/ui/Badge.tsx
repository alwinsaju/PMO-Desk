import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Tones. `neutral`/`accent`/`outline` are the original three; the rest map
 * the redesign's status badges: `success` (done/online), `warning` (waiting
 * on a human), `danger` (failed), `info` (source tags such as Outlook).
 */
export type BadgeVariant =
  "neutral" | "accent" | "outline" | "success" | "warning" | "danger" | "info";

const variantClassName: Record<BadgeVariant, string> = {
  neutral: "bg-chip text-ink-soft",
  accent: "bg-accent-soft text-accent-ink",
  outline: "border border-line-strong text-ink-muted",
  success: "bg-success-soft text-success",
  warning: "bg-amber-soft text-amber",
  danger: "bg-red-soft text-red",
  info: "bg-info-soft text-info",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  /** Reserve a fixed minimum width (centered label) so a badge whose text
   *  changes with state ("Running" -> "Needs you") doesn't make its row jump.
   *  `true` = 104px; a number = that many px. */
  fixedWidth?: boolean | number;
  /** Leading status dot in the badge's text color. */
  dot?: boolean;
  /** Make the dot blink (running / waiting states). Needs `dot`. */
  pulse?: boolean;
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  (
    { className, variant = "neutral", fixedWidth, dot, pulse, style, children, ...props },
    ref,
  ) => {
    const minWidth =
      fixedWidth === true ? 104 : typeof fixedWidth === "number" ? fixedWidth : undefined;
    return (
      <span
        ref={ref}
        style={minWidth ? { minWidth, ...style } : style}
        className={cn(
          "rounded-chip inline-flex h-[25px] items-center gap-1.5 px-[11px] text-xs leading-none font-semibold whitespace-nowrap",
          "transition-colors duration-[400ms]",
          minWidth && "justify-center",
          variantClassName[variant],
          className,
        )}
        {...props}
      >
        {dot && (
          <i
            aria-hidden
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full bg-current not-italic",
              pulse && "motion-safe:animate-blink",
            )}
          />
        )}
        {children}
      </span>
    );
  },
);
Badge.displayName = "Badge";
