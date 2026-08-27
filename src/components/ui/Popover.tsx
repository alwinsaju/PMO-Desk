"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/cn";
import { overlayEnter, overlayExit } from "@/lib/motion";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, sideOffset = 8, align = "center", ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      align={align}
      className={cn(
        "border-border bg-surface-elevated shadow-float-sm z-[var(--z-overlay)] w-72 rounded-xl border p-4",
        "origin-[var(--radix-popper-transform-origin)]",
        "outline-none",
        overlayEnter,
        overlayExit,
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = "PopoverContent";
