import * as React from "react";
import { cn } from "@/lib/cn";

export type BadgeVariant = "neutral" | "accent" | "outline";

const variantClassName: Record<BadgeVariant, string> = {
  neutral: "bg-neutral-100 text-ink-muted",
  accent: "bg-accent-subtle text-accent-800",
  outline: "border border-border text-ink-muted",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "neutral", ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "rounded-pill inline-flex items-center px-2.5 py-0.5 text-[11px] leading-normal font-medium",
        "ease-standard transition-colors duration-150",
        variantClassName[variant],
        className,
      )}
      {...props}
    />
  ),
);
Badge.displayName = "Badge";
