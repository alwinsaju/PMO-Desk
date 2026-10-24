"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/cn";
import type { ButtonVariant } from "./Button";

export type IconButtonSize = "sm" | "md" | "lg";
/** `square` = the control radius tier (12px, 8px in Deloitte mode) — the
 *  default for toolbar buttons; `round` = a true circle (close buttons,
 *  floating actions). */
export type IconButtonShape = "square" | "round";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: IconButtonSize;
  shape?: IconButtonShape;
  asChild?: boolean;
  /** Required — an icon-only button must always be labeled for screen readers. */
  "aria-label": string;
}

const base = cn(
  "transition-ui inline-flex shrink-0 items-center justify-center",
  "focus-visible:ring-focus focus-visible:ring-offset-surface focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
  "disabled:pointer-events-none disabled:opacity-40",
  // The glyph springs up a touch on hover; the button itself stays put.
  "[&_svg]:transition-transform [&_svg]:duration-300 [&_svg]:ease-spring hover:[&_svg]:scale-110",
);

const solid =
  "bg-accent text-accent-contrast hover:bg-accent-hover hover:shadow-halo active:bg-accent-active";
const outline =
  "bg-transparent text-ink-muted shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-chip hover:text-ink";

const variantClassName: Record<ButtonVariant, string> = {
  solid,
  primary: solid,
  secondary: "bg-chip text-ink-soft hover:bg-chip-strong hover:text-ink",
  ghost: "bg-transparent text-ink-soft hover:bg-chip-strong hover:text-ink",
  outline,
  line: outline,
};

const sizeClassName: Record<IconButtonSize, string> = {
  sm: "h-8 w-8 [&_svg]:h-4 [&_svg]:w-4",
  md: "h-9 w-9 [&_svg]:h-[18px] [&_svg]:w-[18px]",
  lg: "h-11 w-11 [&_svg]:h-5 [&_svg]:w-5",
};

const shapeClassName: Record<IconButtonShape, string> = {
  square: "rounded-control",
  round: "rounded-pill",
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      className,
      variant = "ghost",
      size = "md",
      shape = "square",
      asChild = false,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(
          base,
          variantClassName[variant],
          sizeClassName[size],
          shapeClassName[shape],
          className,
        )}
        {...props}
      />
    );
  },
);
IconButton.displayName = "IconButton";
