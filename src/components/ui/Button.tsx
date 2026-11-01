"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/cn";

/** `primary` is an alias of `solid` and `line` of `outline` (the redesign's
 *  names for the same looks), so either spelling works.
 *
 *  Action footers (dialogs, forms, detail panes), left to right:
 *    [destructive]  ...space...  [secondary / cancel]  [primary]
 *  The primary action is always last (right), the secondary next to it, and a
 *  destructive action is pushed apart to the far left: `DialogFooter` does that
 *  for a `destructive*` button automatically (`mr-auto` elsewhere). Use
 *  `destructive` (solid red) when deleting IS the dialog's main action
 *  (a confirm), `destructive-quiet` (red text) when it sits beside Save. */
export type ButtonVariant =
  | "solid"
  | "primary"
  | "secondary"
  | "ghost"
  | "outline"
  | "line"
  | "destructive"
  | "destructive-quiet";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render as the single child element instead of a <button> (Radix Slot),
   *  e.g. `<Button asChild><a href="/x">Link</a></Button>`. */
  asChild?: boolean;
}

const base = cn(
  "sweep transition-ui focus-ring inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap",
  "rounded-chip active:scale-[0.96]",
  "disabled:pointer-events-none disabled:opacity-[var(--opacity-disabled)] [&_svg]:shrink-0",
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
const destructive = cn(
  "bg-red text-ink-inverse shadow-[0_8px_18px_-8px_var(--color-red)]",
  "hover:bg-[color-mix(in_srgb,var(--color-red)_88%,#000)] active:bg-[color-mix(in_srgb,var(--color-red)_80%,#000)]",
  "[--sweep-color:rgba(255,255,255,0.3)]",
);

const variantClassName: Record<ButtonVariant, string> = {
  solid,
  primary: solid,
  secondary: "bg-chip text-ink hover:bg-chip-strong active:bg-chip-strong",
  ghost:
    "text-ink-soft hover:bg-chip hover:text-ink active:bg-chip-strong bg-transparent",
  outline,
  line: outline,
  destructive,
  "destructive-quiet": "text-red hover:bg-red-soft active:bg-red-soft bg-transparent",
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
        data-variant={variant}
        className={cn(base, variantClassName[variant], sizeClassName[size], className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
