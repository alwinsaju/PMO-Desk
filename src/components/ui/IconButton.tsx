"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/cn";
import type { ButtonVariant } from "./Button";

export type IconButtonSize = "sm" | "md" | "lg";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: IconButtonSize;
  asChild?: boolean;
  /** Required — an icon-only button must always be labeled for screen readers. */
  "aria-label": string;
}

const base = cn(
  "inline-flex shrink-0 items-center justify-center rounded-full",
  "transition-colors duration-150 ease-standard",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
  "disabled:pointer-events-none disabled:opacity-40",
);

const variantClassName: Record<ButtonVariant, string> = {
  solid: "bg-accent text-accent-contrast hover:bg-accent-hover active:bg-accent-active",
  secondary:
    "bg-surface-elevated text-ink-muted border border-border shadow-float-sm hover:text-ink hover:bg-neutral-50",
  ghost:
    "bg-transparent text-ink-muted hover:bg-neutral-100 hover:text-ink active:bg-neutral-150",
  outline:
    "bg-transparent text-ink-muted border border-border hover:bg-neutral-50 hover:text-ink",
};

const sizeClassName: Record<IconButtonSize, string> = {
  sm: "h-7 w-7 [&_svg]:h-4 [&_svg]:w-4",
  md: "h-9 w-9 [&_svg]:h-[18px] [&_svg]:w-[18px]",
  lg: "h-11 w-11 [&_svg]:h-5 [&_svg]:w-5",
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant = "ghost", size = "md", asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(base, variantClassName[variant], sizeClassName[size], className)}
        {...props}
      />
    );
  },
);
IconButton.displayName = "IconButton";
