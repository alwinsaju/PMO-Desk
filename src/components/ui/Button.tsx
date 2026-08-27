"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/cn";

export type ButtonVariant = "solid" | "secondary" | "ghost" | "outline";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render as the single child element instead of a <button> (Radix Slot),
   *  e.g. `<Button asChild><a href="/x">Link</a></Button>`. */
  asChild?: boolean;
}

const base = cn(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill font-medium",
  "transition-colors duration-150 ease-standard",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
  "disabled:pointer-events-none disabled:opacity-40",
);

const variantClassName: Record<ButtonVariant, string> = {
  solid: "bg-accent text-accent-contrast hover:bg-accent-hover active:bg-accent-active",
  secondary:
    "bg-surface-elevated text-ink border border-border shadow-float-sm hover:bg-neutral-50 active:bg-neutral-100",
  ghost: "bg-transparent text-ink hover:bg-neutral-100 active:bg-neutral-150",
  outline:
    "bg-transparent text-ink border border-border hover:bg-neutral-50 active:bg-neutral-100",
};

const sizeClassName: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-[15px]",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "solid", size = "md", asChild = false, ...props }, ref) => {
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
Button.displayName = "Button";
