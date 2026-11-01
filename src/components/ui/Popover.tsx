"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/cn";
import { popEnter, popExit } from "@/lib/motion";
import { useCloseOnModalOpen } from "./useCloseOnModalOpen";

/** Radix Popover root that also closes when a modal dialog opens (QA-15). */
export function Popover({
  open,
  defaultOpen = false,
  onOpenChange,
  ...props
}: PopoverPrimitive.PopoverProps) {
  const [innerOpen, setInnerOpen] = React.useState(defaultOpen);
  const isControlled = open !== undefined;
  const change = (next: boolean) => {
    if (!isControlled) setInnerOpen(next);
    onOpenChange?.(next);
  };
  useCloseOnModalOpen(() => change(false));
  return (
    <PopoverPrimitive.Root
      {...props}
      open={isControlled ? open : innerOpen}
      onOpenChange={change}
    />
  );
}
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
        "glass-pop rounded-surface z-[var(--z-overlay)] w-72 p-4",
        "origin-[var(--radix-popper-transform-origin)]",
        "outline-none",
        popEnter,
        popExit,
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = "PopoverContent";
