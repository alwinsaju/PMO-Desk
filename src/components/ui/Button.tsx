"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/cn";

/** `primary` is an alias of `solid` and `line` of `outline` (the redesign's
 *  names for the same looks), so either spelling works. */
export type ButtonVariant =
  "solid" | "primary" | "secondary" | "ghost" | "outline" | "line";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render as the single child element instead of a <button> (Radix Slot),
   *  e.g. `<Button asChild><a href="/x">Link</a></Button>`. */
  asChild?: boolean;
}

const base = cn(
  "sweep transition-ui inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap",
  "rounded-chip active:scale-[0.96]",
  "focus-visible:ring-focus focus-visible:ring-offset-surface focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
  "disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0",
);

const solid = cn(
  "bg-accent text-accent-contrast shadow-[0_8px_18px_-8px_var(--color-accent)]",
  "hover:bg-accent-hover hover:shadow-halo active:bg-accent-active",
  // The light sweep reads white on a solid accent fill.
  "[--sweep-color:rgba(255,255,255,0.42)]",
);
const outline = cn(
  "text-ink bg-transparent shadow-[inset_0_0_0_1px_var(--color-line-strong)]",
  "hover:bg-chip active:bg-chip-strong",
);

const variantClassName: Record<ButtonVariant, string> = {
  solid,
  primary: solid,
  secondary: "bg-chip text-ink hover:bg-chip-strong active:bg-chip-strong",
  ghost:
    "text-ink-soft hover:bg-chip hover:text-ink active:bg-chip-strong bg-transparent",
  outline,
  line: outline,
};

const sizeClassName: Record<ButtonSize, string> = {
  sm: "h-8 px-3.5 text-[13px]",
  md: "h-9 px-[17px] text-[13.5px]",
  lg: "h-11 px-6 text-[15px]",
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
