"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/cn";
import { overlayEnter, overlayExit } from "@/lib/motion";

export const TooltipProvider = TooltipPrimitive.Provider;
export const TooltipRoot = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export type TooltipContentProps = React.ComponentPropsWithoutRef<
  typeof TooltipPrimitive.Content
>;

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  TooltipContentProps
>(({ className, sideOffset = 8, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "bg-ink shadow-float-sm z-[var(--z-overlay)] rounded-md px-2.5 py-1.5 text-[12px] font-medium text-white",
        "origin-[var(--radix-tooltip-content-transform-origin)]",
        overlayEnter,
        overlayExit,
        className,
      )}
      {...props}
    >
      {props.children}
      <TooltipPrimitive.Arrow className="fill-ink" />
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = "TooltipContent";

/** Convenience wrapper for the common case: hover a trigger, see a label.
 *  For anything more custom, compose TooltipRoot/TooltipTrigger/TooltipContent
 *  directly. Remember to render one `<TooltipProvider>` near the app root
 *  (Desktop.tsx) — Radix Tooltip requires it. */
export function Tooltip({
  children,
  label,
  ...contentProps
}: {
  children: React.ReactNode;
  label: React.ReactNode;
} & Omit<TooltipContentProps, "children">) {
  return (
    <TooltipRoot>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent {...contentProps}>{label}</TooltipContent>
    </TooltipRoot>
  );
}
